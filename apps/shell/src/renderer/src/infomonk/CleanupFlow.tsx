import { useState } from 'react'
import type {
  CleanupOptions,
  CleanupPreview,
  TableProfile,
  WorkspaceProject,
} from '../../../shared/workspace-api'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'
import { mt } from './en'

const defaults = (profile: TableProfile): CleanupOptions => ({
  sheetId: profile.sheetId,
  range: profile.range,
  hasHeader: true,
  trim: true,
  removeBlankRows: false,
  keys: [],
  deduplicate: false,
  sortColumn: null,
  descending: false,
  renames: {},
  formats: {},
})
function SampleTable({
  rows,
  formats = {},
  hasHeader = true,
}: {
  rows: CellScalar[][]
  formats?: CleanupOptions['formats']
  hasHeader?: boolean
}) {
  const identityColumn = hasHeader ? (rows[0]?.indexOf('_infomonk_record_id') ?? -1) : -1
  function display(cell: CellScalar, column: number, row: number) {
    const format = row === 0 && hasHeader ? undefined : formats[String(column)]
    if (typeof cell === 'number' && format === 'number')
      return cell.toLocaleString('en', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        useGrouping: false,
      })
    if (typeof cell === 'number' && cell >= 1 && cell <= 2_958_465 && format?.startsWith('date-'))
      return new Date(Date.UTC(1899, 11, 30) + (cell < 60 ? cell + 1 : cell) * 86400000)
        .toISOString()
        .slice(0, 10)
    return String(cell)
  }
  return (
    <div className="im-table-scroll">
      <table>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) =>
                c === identityColumn ? null : (
                  <td key={c}>
                    {cell === null ? <span className="im-muted">—</span> : display(cell, c, r)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
export function CleanupFlow({
  project,
  onChanged,
  onClose,
}: {
  project: WorkspaceProject
  onChanged: (project: WorkspaceProject) => void
  onClose: () => void
}) {
  const [profile, setProfile] = useState<TableProfile | null>(null)
  const [options, setOptions] = useState<CleanupOptions | null>(null)
  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  const inspect = (sheetId?: string, range?: string, hasHeader = true) =>
    run(async () => {
      if (preview) await window.infomonk.discard(preview.token)
      const result = await window.infomonk.profile(project.id, sheetId, range, hasHeader)
      setProfile(result)
      setOptions({ ...defaults(result), hasHeader })
      setPreview(null)
    })
  function patch(values: Partial<CleanupOptions>) {
    setOptions((current) => (current ? { ...current, ...values } : current))
    if (preview) {
      void window.infomonk.discard(preview.token)
      setPreview(null)
    }
  }
  const structural = !!profile?.structuralBlocker
  return (
    <section className="im-cleanup" aria-labelledby="im-clean-title">
      <div className="im-heading">
        <div>
          <h1 id="im-clean-title">{mt('cleanupTitle')}</h1>
          <p className="im-muted">{mt('cleanupDescription')}</p>
        </div>
        <button onClick={onClose}>{mt('close')}</button>
      </div>
      <button className="im-primary" disabled={busy} onClick={() => void inspect()}>
        {busy ? mt('processing') : mt('inspect')}
      </button>
      {error && (
        <p role="alert" className="im-error">
          {error}
        </p>
      )}
      {profile && options && (
        <>
          <div className="im-controls">
            <label>
              {mt('worksheet')}
              <select
                aria-label={mt('worksheet')}
                value={options.sheetId}
                disabled={busy}
                onChange={(event) => void inspect(event.target.value)}
              >
                {profile.sheets.map((sheet) => (
                  <option key={sheet.id} value={sheet.id}>
                    {sheet.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {mt('range')}
              <input
                value={options.range}
                onChange={(event) => patch({ range: event.target.value })}
              />
            </label>
            <label className="im-check">
              <input
                type="checkbox"
                checked={options.hasHeader}
                onChange={(event) => patch({ hasHeader: event.target.checked })}
              />
              {mt('headerRow')}
            </label>
            <button
              disabled={busy}
              onClick={() => void inspect(options.sheetId, options.range, options.hasHeader)}
            >
              {mt('inspect')}
            </button>
          </div>
          <div className="im-stats">
            <span>
              {profile.rowCount} {mt('rows')}
            </span>
            <span>{profile.formulaCount} formulas</span>
            <span>{profile.range}</span>
          </div>
          <p className="im-muted">{mt('storedValues')}</p>
          {profile.structuralBlocker && <p className="im-notice">{profile.structuralBlocker}</p>}
          <h3>{mt('profile')}</h3>
          <div className="im-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{mt('columnName')}</th>
                  <th>{mt('blanks')}</th>
                  <th>{mt('total')}</th>
                  <th>{mt('format')}</th>
                  <th>{mt('duplicateKeys')}</th>
                </tr>
              </thead>
              <tbody>
                {profile.columns.map((column, c) =>
                  column.name === '_infomonk_record_id' ? null : (
                    <tr key={c}>
                      <td>
                        <input
                          aria-label={`${mt('columnName')} ${c + 1}`}
                          value={options.renames[String(c)] ?? column.name}
                          disabled={!options.hasHeader}
                          onChange={(event) =>
                            patch({ renames: { ...options.renames, [c]: event.target.value } })
                          }
                        />
                      </td>
                      <td>{column.blanks}</td>
                      <td>{column.numbers ? column.total.toLocaleString() : '—'}</td>
                      <td>
                        <select
                          aria-label={`${mt('format')} ${column.name}`}
                          value={options.formats[String(c)] ?? ''}
                          onChange={(event) => {
                            const formats = { ...options.formats }
                            if (!event.target.value) delete formats[String(c)]
                            else formats[String(c)] = event.target.value as 'number'
                            patch({ formats })
                          }}
                        >
                          <option value="">{mt('unchanged')}</option>
                          <option value="number">{mt('number')}</option>
                          <option value="date-iso">{mt('isoDate')}</option>
                          <option value="date-us">{mt('usDate')}</option>
                          <option value="date-uk">{mt('ukDate')}</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          disabled={structural}
                          aria-label={`${mt('duplicateKeys')} ${column.name}`}
                          checked={options.keys.includes(c)}
                          onChange={(event) =>
                            patch({
                              keys: event.target.checked
                                ? [...options.keys, c]
                                : options.keys.filter((key) => key !== c),
                            })
                          }
                        />
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
          <div className="im-controls">
            <label className="im-check">
              <input
                type="checkbox"
                checked={options.trim}
                onChange={(event) => patch({ trim: event.target.checked })}
              />
              {mt('trim')}
            </label>
            <label className="im-check">
              <input
                type="checkbox"
                disabled={structural}
                checked={options.removeBlankRows}
                onChange={(event) => patch({ removeBlankRows: event.target.checked })}
              />
              {mt('removeBlanks')}
            </label>
            <label className="im-check">
              <input
                type="checkbox"
                disabled={structural || !options.keys.length}
                checked={options.deduplicate}
                onChange={(event) => patch({ deduplicate: event.target.checked })}
              />
              {mt('dedupe')}
            </label>
            <label>
              {mt('sort')}
              <select
                aria-label={mt('sort')}
                disabled={structural}
                value={options.sortColumn ?? ''}
                onChange={(event) =>
                  patch({
                    sortColumn: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              >
                <option value="">{mt('none')}</option>
                {profile.headers.map((header, c) =>
                  header === '_infomonk_record_id' ? null : (
                    <option key={c} value={c}>
                      {header}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label className="im-check">
              <input
                type="checkbox"
                disabled={structural}
                checked={options.descending}
                onChange={(event) => patch({ descending: event.target.checked })}
              />
              {mt('descending')}
            </label>
          </div>
          <details>
            <summary>{mt('sourceReferences')}</summary>
            <div className="im-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{mt('sourceVersion')}</th>
                    <th>{mt('worksheet')}</th>
                    <th>{mt('originalRow')}</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.recordReferences.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <code>{record.version.slice(0, 16)}</code>
                      </td>
                      <td>{record.sheet}</td>
                      <td>{record.row}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="im-muted">{mt('dedupeNote')}</p>
          <p className="im-muted">{mt('formulasPreserved')}</p>
          <button
            className="im-primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (preview) await window.infomonk.discard(preview.token)
                const result = await window.infomonk.preview(project.id, options)
                setPreview(result)
              })
            }
          >
            {mt('preview')}
          </button>
          {preview && (
            <section className="im-preview">
              <div className="im-stats">
                <span>
                  {preview.inputRows} → {preview.outputRows} {mt('rows')}
                </span>
                <span>
                  {preview.changedCells} {mt('changed')}
                </span>
                <span>
                  {preview.duplicates} {mt('duplicates')}
                </span>
                <span>
                  {preview.blankRows} {mt('blankRows')}
                </span>
              </div>
              {preview.warnings.map((warning) => (
                <p className="im-notice" key={warning}>
                  {warning}
                </p>
              ))}
              <div className="im-compare">
                <div>
                  <h3>{mt('before')}</h3>
                  <SampleTable rows={preview.before} />
                </div>
                <div>
                  <h3>{mt('after')}</h3>
                  <SampleTable
                    rows={preview.after}
                    formats={options.formats}
                    hasHeader={options.hasHeader}
                  />
                </div>
              </div>
              <p className="im-muted">{mt('identities')}</p>
              <div className="im-actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    void window.infomonk.discard(preview.token)
                    setPreview(null)
                  }}
                >
                  {mt('discard')}
                </button>
                <button
                  className="im-primary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const updated = await window.infomonk.apply(project.id, preview.token)
                      onChanged(updated)
                      await window.infomonk.open(project.id)
                      onClose()
                    })
                  }
                >
                  {mt('apply')}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </section>
  )
}
