import { useEffect, useState } from 'react'
import type { WorkspaceProject } from '../../../shared/workspace-api'
import { mt } from './en'

export function ProjectCreator({
  onCreated,
  onClose,
  template,
  startKind = 'general',
}: {
  onCreated: (project: WorkspaceProject) => void
  onClose: () => void
  template?: { projectId: string; workflowId: string }
  startKind?: 'general' | 'extractFiles' | 'researchWeb' | 'workSpreadsheet'
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [filePath, setFilePath] = useState<string | undefined>()
  const [url, setUrl] = useState('')
  const [delimiter, setDelimiter] = useState<string | undefined>()
  const [sample, setSample] = useState<string[][]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(
    () =>
      window.infomonk.onSourceDrop((paths) => {
        const path = paths[0]
        if (!path) return
        setFilePath(path)
        setDelimiter(undefined)
        setName(
          (current) =>
            current ||
            path
              .split(/[\\/]/)
              .pop()!
              .replace(/\.[^.]+$/, ''),
        )
      }),
    [],
  )
  useEffect(() => {
    if (!filePath) return
    let alive = true
    void window.infomonk
      .filePreview(filePath, delimiter)
      .then((result) => {
        if (!alive) return
        setSample(result.rows)
        if (delimiter === undefined && result.delimiter) setDelimiter(result.delimiter)
      })
      .catch((err) => {
        if (alive) setError(String(err))
      })
    return () => {
      alive = false
    }
  }, [filePath, delimiter])
  async function choose() {
    try {
      const path = await window.infomonk.pickFile()
      if (!path) return
      if (!/\.(xlsx|csv|tsv|docx|pdf|md|txt)$/i.test(path)) {
        setError(mt('chooseWorkbook'))
        return
      }
      setFilePath(path)
      setDelimiter(undefined)
      setError('')
      if (!name)
        setName(
          path
            .split(/[\\/]/)
            .pop()!
            .replace(/\.[^.]+$/, ''),
        )
    } catch (err) {
      setError(String(err))
    }
  }
  async function submit() {
    setBusy(true)
    setError('')
    try {
      if (template) {
        const id = await window.infomonkResearch.createFrom(
          template.projectId,
          template.workflowId,
          name.trim(),
          description.trim(),
        )
        const project = (await window.infomonk.list()).find((p) => p.id === id)
        if (!project) throw new Error('Created project could not be loaded.')
        onCreated(project)
        return
      }
      const project = await window.infomonk.create({
        startKind,
        name: name.trim(),
        description,
        ...(filePath ? { filePath } : {}),
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(delimiter ? { delimiter } : {}),
      })
      onCreated(project)
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="im-modal-shade"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onClose()
      }}
    >
      <form
        className="im-dialog"
        role="dialog"
        data-infomonk-source-drop
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
        aria-modal="true"
        aria-labelledby="im-create-title"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="im-heading">
          <h2 id="im-create-title">{mt('newProject')}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label={mt('close')}>
            ×
          </button>
        </div>
        {!template && (
          <p className="im-muted">
            {mt(
              startKind === 'extractFiles'
                ? 'extractStart'
                : startKind === 'researchWeb'
                  ? 'webStart'
                  : startKind === 'workSpreadsheet'
                    ? 'spreadsheetStart'
                    : 'generalStart',
            )}
          </p>
        )}
        {template && (
          <p>
            Start with the saved workflow structure and instructions. Choose inputs in the new
            project; prior records, sources, schedules and credentials are not copied.
          </p>
        )}
        <label>
          {mt('projectName')}
          <input
            autoFocus
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {mt('goal')}
          <textarea
            value={description}
            onBlur={() => {
              if (!name && description.trim()) setName(description.trim().slice(0, 60))
            }}
            maxLength={4000}
            onChange={(event) => {
              setDescription(event.target.value)
            }}
          />
        </label>
        {!template && (
          <>
            <label>
              {mt('file')}
              <button type="button" aria-label={mt('chooseFile')} onClick={() => void choose()}>
                {filePath?.split(/[\\/]/).pop() ?? mt('chooseFile')}
              </button>
            </label>
            {sample.length > 0 && (
              <>
                <label>
                  {mt('delimiter')}
                  <select
                    aria-label={mt('delimiter')}
                    value={delimiter}
                    onChange={(event) => setDelimiter(event.target.value)}
                  >
                    {[
                      [',', 'comma'],
                      [';', 'semicolon'],
                      ['\t', 'tab'],
                      ['|', 'pipe'],
                    ].map(([value, key]) => (
                      <option key={value} value={value}>
                        {mt(key as 'comma')}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="im-table-scroll">
                  <table aria-label={mt('importPreview')}>
                    <tbody>
                      {sample.map((row, r) => (
                        <tr key={r}>
                          {row.map((cell, c) => (
                            <td key={c}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <label>
              {mt('url')}
              <input
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://"
              />
            </label>
            <p className="im-muted">{mt('unavailableCreation')}</p>
          </>
        )}
        {error && (
          <p role="alert" className="im-error">
            {error}
          </p>
        )}
        <div className="im-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            {mt('cancel')}
          </button>
          <button className="im-primary" disabled={busy || !name.trim()}>
            {busy ? mt('creating') : mt('create')}
          </button>
        </div>
      </form>
    </div>
  )
}
