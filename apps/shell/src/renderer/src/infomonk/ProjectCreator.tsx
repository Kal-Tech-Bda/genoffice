import { useEffect, useRef, useState } from 'react'
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
  const [previewVersion, setPreviewVersion] = useState(0)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLFormElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  useEffect(() => {
    nameInput.current?.focus()
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [returnFocus])
  useEffect(
    () =>
      window.infomonk.onSourceDrop((paths) => {
        const path = paths[0]
        if (!path || busy) return
        if (!/\.(xlsx|csv|tsv|docx|pdf|md|txt)$/i.test(path)) {
          setError(mt('chooseWorkbook'))
          return
        }
        setFilePath(path)
        setDelimiter(undefined)
        setSample([])
        setPreviewLoading(true)
        setPreviewFailed(false)
        setPreviewVersion((value) => value + 1)
        setError('')
        setName(
          (current) =>
            current ||
            path
              .split(/[\\/]/)
              .pop()!
              .replace(/\.[^.]+$/, ''),
        )
      }),
    [busy],
  )
  useEffect(() => {
    if (!filePath) return
    let alive = true
    setSample([])
    setPreviewLoading(true)
    setPreviewFailed(false)
    setError('')
    void window.infomonk
      .filePreview(filePath, delimiter)
      .then((result) => {
        if (!alive) return
        setSample(result.rows)
        if (delimiter === undefined && result.delimiter) setDelimiter(result.delimiter)
      })
      .catch((err) => {
        if (alive) {
          setError(String(err))
          setPreviewFailed(true)
        }
      })
      .finally(() => {
        if (alive) setPreviewLoading(false)
      })
    return () => {
      alive = false
    }
  }, [filePath, delimiter, previewVersion])
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
      setSample([])
      setPreviewLoading(true)
      setPreviewFailed(false)
      setPreviewVersion((value) => value + 1)
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
    if (busy || previewLoading || previewFailed) return
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
    <div className="im-modal-shade">
      <form
        ref={dialog}
        className="im-dialog"
        role="dialog"
        data-infomonk-source-drop
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
        aria-modal="true"
        aria-labelledby="im-create-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (!busy) onClose()
          }
          if (event.key !== 'Tab') return
          const controls = Array.from(
            dialog.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]',
            ) ?? [],
          ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
          if (!controls.length) {
            event.preventDefault()
            return
          }
          const first = controls[0]
          const last = controls.at(-1)
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last?.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first?.focus()
          }
        }}
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
            ref={nameInput}
            autoFocus
            required
            disabled={busy}
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          {mt('goal')}
          <textarea
            disabled={busy}
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
              <button
                type="button"
                aria-label={mt('chooseFile')}
                disabled={busy}
                onClick={() => void choose()}
              >
                {filePath?.split(/[\\/]/).pop() ?? mt('chooseFile')}
              </button>
            </label>
            {filePath && /\.(csv|tsv)$/i.test(filePath) && (
              <>
                <label>
                  {mt('delimiter')}
                  <select
                    aria-label={mt('delimiter')}
                    disabled={busy || previewLoading}
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
              </>
            )}
            {previewLoading && <p role="status">Reading selected file…</p>}
            {sample.length > 0 && (
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
            )}
            <label>
              {mt('url')}
              <input
                type="url"
                disabled={busy}
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
          <button
            className="im-primary"
            disabled={busy || previewLoading || previewFailed || !name.trim()}
          >
            {busy ? mt('creating') : mt('create')}
          </button>
        </div>
      </form>
    </div>
  )
}
