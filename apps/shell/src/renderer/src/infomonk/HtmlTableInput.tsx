import { useEffect, useId, useRef, useState } from 'react'
import type { WorkspaceProject } from '../../../shared/workspace-api'
import type { HtmlTableDiscovery, ResearchConfig } from '../../../shared/research-api'

export function HtmlTableInput({
  project,
  config,
  onChange,
}: {
  project: WorkspaceProject
  config: ResearchConfig
  onChange: (config: ResearchConfig) => void
}) {
  const [captured, setCaptured] = useState<{
    sourceKey: string
    value: HtmlTableDiscovery
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const helpId = useId()
  const request = useRef(0)
  const input = config.htmlTables ?? { url: '', selections: [] }
  const sourceVersion = project.workspace?.sources.find((s) => s.id === input.sourceId)?.sha256
  const sourceKey = JSON.stringify([project.id, input.url, input.sourceId, sourceVersion])
  const configRef = useRef(config)
  configRef.current = config
  const sourceRef = useRef(sourceKey)
  sourceRef.current = sourceKey
  const previousSource = useRef(sourceKey)
  const discovery = captured?.sourceKey === sourceKey ? captured.value : null
  const savedHtmlSources = (project.workspace?.sources ?? []).filter(
    (source) => /\.html?$/i.test(source.name) && source.snapshotPath,
  )
  const supportedTables = discovery?.tables.filter((table) => table.supported) ?? []
  const confirmedHeaders = input.selections.filter(
    (selection) => selection.confirmFirstRowAsHeader === true,
  ).length
  const allHeadersConfirmed =
    input.selections.length > 0 && confirmedHeaders === input.selections.length
  const mixedHeaders = confirmedHeaders > 0 && !allHeadersConfirmed
  useEffect(() => {
    const activeRequests = request
    activeRequests.current++
    setCaptured(null)
    setLoading(false)
    setError('')
    const latest = configRef.current
    if (
      previousSource.current !== sourceKey &&
      latest.kind === 'htmlTables' &&
      latest.htmlTables &&
      (latest.htmlTables.captureId || latest.htmlTables.selections.length)
    )
      onChange({
        ...latest,
        htmlTables: { ...latest.htmlTables, captureId: undefined, selections: [] },
      })
    previousSource.current = sourceKey
    return () => {
      activeRequests.current++
    }
  }, [sourceKey, onChange])
  const local = input.sourceId !== undefined
  function changeSource(patch: { url?: string; sourceId?: string }) {
    request.current++
    onChange({ ...config, htmlTables: { ...patch, selections: [] } })
  }
  async function discover() {
    const id = ++request.current
    const current = () =>
      id === request.current &&
      sourceRef.current === sourceKey &&
      configRef.current.kind === 'htmlTables'
    setLoading(true)
    setError('')
    setCaptured(null)
    onChange({
      ...configRef.current,
      htmlTables: { ...input, captureId: undefined, selections: [] },
    })
    try {
      const value = await window.infomonkResearch.discoverTables(
        project.id,
        local ? { sourceId: input.sourceId } : { url: input.url },
      )
      const latest = configRef.current
      if (!current()) return
      setCaptured({ sourceKey, value })
      onChange({
        ...latest,
        htmlTables: { ...latest.htmlTables, captureId: value.captureId, selections: [] },
      })
    } catch (err) {
      if (current()) setError(String(err))
    } finally {
      if (current()) setLoading(false)
    }
  }
  function useFirstColumn() {
    if (!discovery) return
    const selections = input.selections.map((selection) => {
      const column = discovery.tables.find((table) => table.id === selection.tableId)?.columns[0]
      return column ? { ...selection, keyColumns: [column.id] } : null
    })
    if (selections.some((selection) => selection === null)) {
      setError('The selected tables have changed. Find tables again and confirm their record keys.')
      return
    }
    onChange({
      ...configRef.current,
      htmlTables: { ...input, selections: selections.filter((selection) => selection !== null) },
    })
  }
  return (
    <section className="im-html-input" aria-label="Whole website table input">
      <p>
        Capture a public page or saved HTML snapshot, inspect its tables and source notes, then
        choose the tables and unique record keys to maintain. Every source row is read. Dates and
        numbers stay source text.
      </p>
      <div className="im-controls" aria-busy={loading}>
        <label>
          Table source
          <select
            aria-label="Table source"
            value={local ? 'file' : 'web'}
            disabled={loading}
            onChange={(e) =>
              changeSource(
                e.target.value === 'web'
                  ? { url: '' }
                  : {
                      sourceId: savedHtmlSources[0]?.id ?? '',
                    },
              )
            }
          >
            <option value="web">Public HTTPS page</option>
            <option value="file">Saved HTML source</option>
          </select>
        </label>
        {local ? (
          <label>
            Saved HTML source
            <select
              aria-label="Saved HTML source"
              aria-describedby={`${helpId}-source`}
              disabled={loading}
              value={input.sourceId}
              onChange={(e) => changeSource({ sourceId: e.target.value })}
            >
              <option value="">Choose an HTML snapshot</option>
              {savedHtmlSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="im-html-url">
            Public table URL
            <input
              aria-label="Public table URL"
              aria-describedby={`${helpId}-source`}
              type="url"
              autoComplete="url"
              spellCheck={false}
              maxLength={4096}
              disabled={loading}
              placeholder="https://www.gov.bm/public-holidays"
              value={input.url ?? ''}
              onChange={(e) => changeSource({ url: e.target.value })}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.nativeEvent.isComposing &&
                  !loading &&
                  input.url?.trim()
                ) {
                  e.preventDefault()
                  void discover()
                }
              }}
            />
          </label>
        )}
        <button
          type="button"
          disabled={loading || !(input.url?.trim() || input.sourceId)}
          onClick={() => void discover()}
        >
          {loading ? 'Reading the complete page…' : 'Find tables on this page'}
        </button>
      </div>
      <p className="im-muted" id={`${helpId}-source`}>
        {local && !savedHtmlSources.length
          ? 'Add an HTML file in Sources, then choose its saved snapshot here. '
          : ''}
        Static tables only. Sign-in pages, scripts, merged cells and paginated tables need another
        capture method.{' '}
        {local
          ? 'The selected saved snapshot is read.'
          : 'Only the confirmed page and same-site redirects are read.'}
      </p>
      {loading && <p role="status">Reading the source and identifying complete tables…</p>}
      {error && <p role="alert">{error}</p>}
      {discovery && (
        <>
          <p role="status">
            {discovery.tables.length} tables found ·{' '}
            {discovery.tables.reduce((sum, t) => sum + t.rowCount, 0)} source rows · checked{' '}
            {new Date(discovery.retrievedAt).toLocaleString()}
          </p>
          <div className="im-controls">
            <button
              type="button"
              disabled={loading || !supportedTables.length}
              aria-describedby={`${helpId}-selection`}
              onClick={() =>
                onChange({
                  ...config,
                  htmlTables: {
                    ...input,
                    selections: supportedTables.map((t) => ({
                      tableId: t.id,
                      keyColumns: [],
                      confirmFirstRowAsHeader: !t.headerNeedsConfirmation,
                    })),
                  },
                })
              }
            >
              Select all supported tables
            </button>
            <label>
              <input
                type="checkbox"
                disabled={!input.selections.length}
                checked={allHeadersConfirmed}
                aria-checked={mixedHeaders ? 'mixed' : allHeadersConfirmed}
                aria-describedby={`${helpId}-selection`}
                ref={(element) => {
                  if (element) element.indeterminate = mixedHeaders
                }}
                onChange={(e) =>
                  onChange({
                    ...config,
                    htmlTables: {
                      ...input,
                      selections: input.selections.map((s) => ({
                        ...s,
                        confirmFirstRowAsHeader: e.target.checked,
                      })),
                    },
                  })
                }
              />
              First row contains column names in selected tables
            </label>
            <button
              type="button"
              disabled={!input.selections.length}
              aria-describedby={`${helpId}-selection`}
              onClick={useFirstColumn}
            >
              Use first column as record key
            </button>
          </div>
          <small id={`${helpId}-selection`}>
            Inspect the preview before confirming headers or using the first column as a key. Select
            multiple key columns when one column is not unique. Full-table validation rejects
            duplicate or blank keys; it never merges rows silently.
          </small>
          <p role="status">
            {input.selections.length
              ? `${input.selections.length} tables selected · ${input.selections.length - confirmedHeaders} need header confirmation · ${input.selections.filter((selection) => !selection.keyColumns.length).length} need record keys`
              : 'No tables selected. Choose supported tables below, then confirm their headers and record keys.'}
          </p>
          {discovery.issues.map((issue, i) => (
            <p className="im-muted" key={i}>
              {issue}
            </p>
          ))}
          {discovery.tables.map((table) => {
            const selection = input.selections.find((s) => s.tableId === table.id)
            const change = (next: typeof selection) =>
              onChange({
                ...config,
                htmlTables: {
                  ...input,
                  selections: [
                    ...input.selections.filter((s) => s.tableId !== table.id),
                    ...(next ? [next] : []),
                  ],
                },
              })
            return (
              <article className="im-html-table-choice" key={table.id}>
                <label>
                  <input
                    type="checkbox"
                    disabled={!table.supported || loading}
                    aria-describedby={
                      table.blockers.length ? `${helpId}-${table.id}-blockers` : undefined
                    }
                    checked={!!selection}
                    onChange={(e) =>
                      change(
                        e.target.checked
                          ? {
                              tableId: table.id,
                              keyColumns: [],
                              confirmFirstRowAsHeader: !table.headerNeedsConfirmation,
                            }
                          : undefined,
                      )
                    }
                  />
                  Use {table.name} ({table.rowCount} rows)
                </label>
                {table.blockers.length > 0 && (
                  <div id={`${helpId}-${table.id}-blockers`}>
                    {table.blockers.map((message, i) => (
                      <p className="im-error" key={i}>
                        {message}
                      </p>
                    ))}
                  </div>
                )}
                {table.warnings.map((message, i) => (
                  <p className="im-muted" key={i}>
                    {message}
                  </p>
                ))}
                {table.notes.length > 0 && (
                  <details className="im-html-source-notes">
                    <summary>Source context notes · {table.notes.length}</summary>
                    {table.notes.map((note, i) => (
                      <p key={i}>{note.text}</p>
                    ))}
                  </details>
                )}
                {selection && (
                  <>
                    {table.headerNeedsConfirmation && (
                      <label>
                        <input
                          type="checkbox"
                          checked={selection.confirmFirstRowAsHeader ?? false}
                          onChange={(e) =>
                            change({ ...selection, confirmFirstRowAsHeader: e.target.checked })
                          }
                        />
                        First row contains column names for {table.name}
                      </label>
                    )}
                    <fieldset aria-describedby={`${helpId}-${table.id}-keys`}>
                      <legend>Record key for {table.name}</legend>
                      <small id={`${helpId}-${table.id}-keys`}>
                        Choose columns whose combined values uniquely identify each row. Keys cannot
                        be blank or duplicated.
                      </small>
                      <div className="im-controls">
                        {table.columns.map((column) => (
                          <label key={column.id}>
                            <input
                              type="checkbox"
                              checked={selection.keyColumns.includes(column.id)}
                              onChange={(e) =>
                                change({
                                  ...selection,
                                  keyColumns: e.target.checked
                                    ? [...selection.keyColumns, column.id]
                                    : selection.keyColumns.filter((k) => k !== column.id),
                                })
                              }
                            />
                            {column.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </>
                )}
                <details>
                  <summary>
                    Preview {table.name} · first {table.sample.length} of {table.rowCount} rows
                  </summary>
                  <div className="im-table-scroll">
                    <table
                      aria-label={`${table.name} preview: first ${table.sample.length} of ${table.rowCount} source rows`}
                    >
                      <thead>
                        <tr>
                          {table.columns.map((c) => (
                            <th key={c.id} scope="col">
                              {c.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.sample.map((row, i) => (
                          <tr key={i}>
                            {row.map((text, j) => (
                              <td key={j}>{text || 'Blank source cell'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </article>
            )
          })}
          <p>
            Building the table uses every row of each selected table. This preview does not
            represent the complete dataset.
          </p>
        </>
      )}
      {!discovery && input.selections.length > 0 && (
        <p className="im-muted">
          {input.selections.length} tables configured. Find tables again to inspect or change
          selection; accepted data remains intact.
        </p>
      )}
    </section>
  )
}
