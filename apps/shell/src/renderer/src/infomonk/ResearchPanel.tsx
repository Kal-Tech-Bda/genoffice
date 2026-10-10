import { useEffect, useState } from 'react'
import type { WorkspaceProject } from '../../../shared/workspace-api'
import type {
  Evidence,
  ResearchApi,
  ResearchConfig,
  ResearchDataset,
  ResearchRow,
  ResearchState,
  ResearchTable,
  ResearchWorkflow,
} from '../../../shared/research-api'
import './research.css'

declare global {
  interface Window {
    infomonkResearch: ResearchApi
  }
}
const fields = ['quote_id', 'supplier', 'date', 'currency', 'total', 'country_code']
const taskNames = {
  quotes: 'Supplier quotes',
  worldbank: 'Public population',
  enrich: 'Quote enrichment',
}
const initial: ResearchConfig = {
  kind: 'quotes',
  instructions: 'Extract labeled supplier quotes; leave unsupported or missing facts for review.',
  sourceIds: [],
  fields,
  countries: ['CAN', 'USA'],
  fromYear: 2023,
  toYear: 2024,
}
export function ResearchPanel({ project }: { project: WorkspaceProject }) {
  const [state, setState] = useState<ResearchState>({ workflows: [], runs: [], executor: '' })
  const [editingId, setEditingId] = useState<string | undefined>()
  const [name, setName] = useState('Supplier quotes')
  const [config, setConfig] = useState<ResearchConfig>({
    ...initial,
    sourceIds:
      project.workspace?.sources
        .filter((s) => /\.(pdf|docx|md|txt)$/i.test(s.name))
        .map((s) => s.id) ?? [],
  })
  const [countryText, setCountryText] = useState(initial.countries.join(', '))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [accepted, setAccepted] = useState<ResearchDataset | null>(null)
  const [showAccepted, setShowAccepted] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledge, setAcknowledge] = useState(false)
  const [removals, setRemovals] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{
    table: ResearchTable
    row: ResearchRow
    column: string
  } | null>(null)
  const [inspection, setInspection] = useState<{
    text: string
    locator: string
    sourceName: string
  } | null>(null)
  const [correction, setCorrection] = useState('')
  const [reason, setReason] = useState('')
  const [schedule, setSchedule] = useState('manual')
  const workflow = state.workflows.find((w) => w.id === selectedId)
  const run = state.runs.find((r) => r.id === runId)
  const dataset = showAccepted ? accepted : run?.candidate
  async function refresh() {
    setState(await window.infomonkResearch.state(project.id))
  }
  useEffect(() => {
    let live = true
    const read = () =>
      void window.infomonkResearch
        .state(project.id)
        .then((value) => {
          if (live) setState(value)
        })
        .catch((err) => {
          if (live) setError(String(err))
        })
    read()
    const timer = setInterval(read, 1500)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [project.id])
  async function act(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  async function select(w: ResearchWorkflow) {
    setSelectedId(w.id)
    setRunId(state.runs.find((r) => r.workflowId === w.id)?.id ?? null)
    setAccepted(await window.infomonkResearch.accepted(project.id, w.id))
    setShowAccepted(false)
    setSelectedCell(null)
    setInspection(null)
    setSchedule(w.scheduleMinutes?.toString() ?? 'manual')
    setAcknowledge(false)
    setRemovals(false)
  }
  function edit(w: ResearchWorkflow) {
    setEditingId(w.id)
    setName(w.name)
    setConfig(w.config)
    setCountryText(w.config.countries.join(', '))
  }
  async function save() {
    const w = await window.infomonkResearch.save(
      project.id,
      name,
      {
        ...config,
        countries: countryText
          .split(/[,;\s]+/)
          .filter(Boolean)
          .map((c) => c.toUpperCase()),
      },
      editingId,
    )
    setSelectedId(w.id)
    setEditingId(undefined)
    setRunId(null)
    setAccepted(await window.infomonkResearch.accepted(project.id, w.id))
  }
  async function start(sample: boolean) {
    if (!workflow) return
    const next = await window.infomonkResearch.run(project.id, workflow.id, sample)
    setRunId(next.id)
    setShowAccepted(false)
    setSelectedCell(null)
    setInspection(null)
    setAcknowledge(false)
  }
  async function inspect(e: Evidence) {
    setInspection(await window.infomonkResearch.evidence(project.id, e))
  }
  return (
    <section className="im-research">
      <p className="im-muted">
        Build a traceable table, inspect a sample, then process all confirmed inputs. Supported
        sources: labeled supplier quotes and World Bank population observations. Every refresh
        creates a candidate for review.
      </p>
      {error && (
        <p role="alert" className="im-error">
          {error}
        </p>
      )}
      <details className="im-research-config" open={!!editingId || !state.workflows.length}>
        <summary>
          {editingId ? 'Edit workflow configuration' : 'Create a research workflow'}
        </summary>
        <label>
          Workflow name
          <input
            aria-label="Workflow name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Task
          <select
            aria-label="Research task"
            value={config.kind}
            onChange={(e) =>
              setConfig({ ...config, kind: e.target.value as ResearchConfig['kind'] })
            }
          >
            <option value="quotes">Supplier quotes → structured sheets</option>
            <option value="worldbank">World Bank population → research table</option>
            <option value="enrich">Enrich accepted quotes by country code</option>
          </select>
        </label>
        <label>
          Instructions / notes
          <textarea
            aria-label="Workflow instructions"
            value={config.instructions}
            onChange={(e) => setConfig({ ...config, instructions: e.target.value })}
          />
        </label>
        <small>
          Notes are saved with the configuration. The supported rules and validation checks below
          define execution; free-text notes do not expand extraction or access scope.
        </small>
        {config.kind === 'quotes' ? (
          <>
            <p>
              One row per Quote ID; numbered items become a related Line items sheet. Required
              heading: “Supplier Quote”. Fields use “Label: value”; dates are ISO, amounts are plain
              decimals. Items use “Item 1 | Description | Quantity | Unit price”. Scans and
              arbitrary document families are unsupported.
            </p>
            <fieldset>
              <legend>Immutable input snapshots (maximum 20)</legend>
              {project.workspace?.sources
                .filter((s) => s.snapshotPath && /\.(pdf|docx|md|txt)$/i.test(s.name))
                .map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      checked={config.sourceIds.includes(s.id)}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          sourceIds: e.target.checked
                            ? [...config.sourceIds, s.id]
                            : config.sourceIds.filter((id) => id !== s.id),
                        })
                      }
                    />
                    {s.name} · {s.sha256?.slice(0, 8)}
                  </label>
                ))}
            </fieldset>
            <fieldset>
              <legend>Typed quote schema</legend>
              {fields.map((field) => (
                <label key={field}>
                  <input
                    type="checkbox"
                    disabled={field === 'quote_id'}
                    checked={config.fields.includes(field)}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        fields: e.target.checked
                          ? [...config.fields, field]
                          : config.fields.filter((f) => f !== field),
                      })
                    }
                  />
                  {field} · {field === 'total' ? 'number' : field === 'date' ? 'ISO date' : 'text'}
                </label>
              ))}
            </fieldset>
          </>
        ) : (
          <>
            <p>
              Public World Bank V2 API · SP.POP.TOTL · one observation per ISO3 country and year.
              Confirm at most 10 codes and 3 years (30 records). Requests contain only these public
              country codes and years. No credentials or internal document text are sent. This
              adapter does not cover arbitrary websites.
            </p>
            <label>
              Confirmed country codes
              <input
                aria-label="Confirmed country codes"
                value={countryText}
                onChange={(e) => setCountryText(e.target.value)}
              />
            </label>
            <div className="im-controls">
              <label>
                From year
                <input
                  type="number"
                  aria-label="From year"
                  value={config.fromYear}
                  onChange={(e) => setConfig({ ...config, fromYear: Number(e.target.value) })}
                />
              </label>
              <label>
                To year
                <input
                  type="number"
                  aria-label="To year"
                  value={config.toYear}
                  onChange={(e) => setConfig({ ...config, toYear: Number(e.target.value) })}
                />
              </label>
            </div>
            {config.kind === 'enrich' && (
              <label>
                Accepted internal quote workflow
                <select
                  aria-label="Accepted internal quote workflow"
                  value={config.parentWorkflowId ?? ''}
                  onChange={(e) =>
                    setConfig({ ...config, parentWorkflowId: e.target.value || undefined })
                  }
                >
                  <option value="">Choose an accepted quote table</option>
                  {state.workflows
                    .filter((w) => w.config.kind === 'quotes' && w.acceptedRevision > 0)
                    .map((w) => (
                      <option value={w.id} key={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {config.kind === 'enrich' && (
              <p>
                Matching uses exact country_code in the accepted quote schema. Missing, out-of-scope
                or ambiguous matches remain review issues. External population fields retain their
                own evidence.
              </p>
            )}
          </>
        )}
        <button
          disabled={busy || !name.trim()}
          className="im-primary"
          onClick={() => void act(save)}
        >
          {editingId ? 'Save new configuration version' : 'Save workflow'}
        </button>
      </details>
      <div className="im-workflow-cards">
        {state.workflows.map((w) => {
          const latest = state.runs.find((r) => r.workflowId === w.id)
          return (
            <article key={w.id} className={selectedId === w.id ? 'selected' : ''}>
              <button className="im-workflow-title" onClick={() => void act(() => select(w))}>
                {w.name}
              </button>
              <p>
                {taskNames[w.config.kind]} · configuration {w.configVersion} · accepted revision{' '}
                {w.acceptedRevision}
              </p>
              <small>
                {w.config.kind === 'quotes'
                  ? `${w.config.sourceIds.length} input snapshots`
                  : `${w.config.countries.join(', ')} / ${w.config.fromYear}–${w.config.toYear}`}
              </small>
              <p>{latest ? `${latest.status}: ${latest.progress}` : 'No runs yet'}</p>
              <small>
                Destination: {w.destination?.split(/[\\/]/).pop() ?? 'New reviewed XLSX revision'} ·{' '}
                {w.paused
                  ? 'Schedule paused'
                  : w.scheduleMinutes
                    ? `Every ${w.scheduleMinutes} minutes while app is open`
                    : 'Manual trigger'}
              </small>
              <div className="im-controls">
                <button
                  onClick={() => {
                    edit(w)
                    void act(() => select(w))
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() =>
                    void act(async () => {
                      const template = await window.infomonkResearch.copy(project.id, w.id)
                      edit(template)
                      await select(template)
                    })
                  }
                >
                  Copy structure and instructions
                </button>
              </div>
            </article>
          )
        })}
      </div>
      {workflow && (
        <>
          <h2>{workflow.name}</h2>
          <div className="im-controls">
            <button disabled={busy} onClick={() => void act(() => start(true))}>
              Run sample
            </button>
            <button
              className="im-primary"
              disabled={busy}
              onClick={() => void act(() => start(false))}
            >
              Run all confirmed inputs
            </button>
            <button
              disabled={!workflow.destination || busy}
              onClick={() => void act(() => window.infomonkResearch.open(project.id, workflow.id))}
            >
              Open accepted workbook
            </button>
            <button
              disabled={!workflow.acceptedRevision}
              onClick={() =>
                void act(async () => {
                  setAccepted(await window.infomonkResearch.accepted(project.id, workflow.id))
                  setShowAccepted(true)
                  setSelectedCell(null)
                })
              }
            >
              Inspect accepted table
            </button>
          </div>
          <div className="im-controls">
            <label>
              Schedule
              <select
                aria-label="Workflow schedule"
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
              >
                <option value="manual">Manual only</option>
                <option value="15">Every 15 minutes</option>
                <option value="60">Every hour</option>
                <option value="1440">Daily while app is open</option>
              </select>
            </label>
            <button
              onClick={() =>
                void act(() =>
                  window.infomonkResearch.schedule(
                    project.id,
                    workflow.id,
                    schedule === 'manual' ? null : Number(schedule),
                    false,
                  ),
                )
              }
            >
              Update schedule
            </button>
            <button
              disabled={!workflow.scheduleMinutes}
              onClick={() =>
                void act(() =>
                  window.infomonkResearch.schedule(
                    project.id,
                    workflow.id,
                    workflow.scheduleMinutes,
                    !workflow.paused,
                  ),
                )
              }
            >
              {workflow.paused ? 'Resume schedule' : 'Pause schedule'}
            </button>
          </div>
          <p className="im-muted">
            {state.executor}{' '}
            {workflow.nextAt && `Next due: ${new Date(workflow.nextAt).toLocaleString()}`}
          </p>
          <details open>
            <summary>Run history</summary>
            {state.runs
              .filter((r) => r.workflowId === workflow.id)
              .map((r) => (
                <article className="im-run-row" key={r.id}>
                  <button
                    onClick={() => {
                      setRunId(r.id)
                      setShowAccepted(false)
                      setSelectedCell(null)
                      setInspection(null)
                    }}
                  >
                    {new Date(r.createdAt).toLocaleString()} · {r.sample ? 'sample' : 'full'} ·{' '}
                    {r.status}
                  </button>
                  <span>
                    {r.progress} · {r.coverage.complete}/{r.coverage.total} complete ·{' '}
                    {r.coverage.failed} failed
                  </span>
                  {['queued', 'acquiring', 'processing', 'review'].includes(r.status) && (
                    <button
                      onClick={() =>
                        void act(() => window.infomonkResearch.cancel(project.id, r.id))
                      }
                    >
                      Cancel run
                    </button>
                  )}
                  {['failed', 'cancelled'].includes(r.status) && (
                    <button
                      onClick={() =>
                        void act(async () => {
                          setRunId((await window.infomonkResearch.retry(project.id, r.id)).id)
                        })
                      }
                    >
                      Retry durable inputs
                    </button>
                  )}
                  {r.error && <p role="alert">{r.error}</p>}
                </article>
              ))}
          </details>
          {run && !showAccepted && (
            <p role="status">
              {run.status} · {run.progress} · added {run.changes.added}, changed{' '}
              {run.changes.changed}, absent {run.changes.removed}.{' '}
              {run.sample &&
                'Sample only; cannot publish. Cancel the sample, adjust the configuration if needed, then run all confirmed inputs.'}
            </p>
          )}
          {run && (
            <details>
              <summary>
                Execution and validation events ·{' '}
                {run.events.filter((e) => e.status === 'queued').length} attempts
              </summary>
              {run.events.map((e, i) => (
                <p key={i}>
                  {new Date(e.at).toLocaleString()} · {e.status} · {e.message}
                </p>
              ))}
            </details>
          )}
          {run?.candidate && !showAccepted && accepted && (
            <details>
              <summary>Records absent from this acquisition · {run.changes.removed}</summary>
              {accepted.tables.flatMap((table) =>
                table.rows
                  .filter(
                    (row) =>
                      !run.candidate?.tables
                        .find((t) => t.id === table.id)
                        ?.rows.some((r) => r.id === row.id),
                  )
                  .map((row) => (
                    <p key={`${table.id}:${row.id}`}>
                      {table.name} · {row.id.slice(0, 8)} ·{' '}
                      {Object.values(row.cells)
                        .map((c) => String(c.value ?? 'Missing'))
                        .join(' / ')}
                    </p>
                  )),
              )}
              <p>
                Absence is not proof of intentional deletion. Retain by default; the reviewed
                removal option controls publication. Overridden records remain.
              </p>
            </details>
          )}
          {dataset && (
            <>
              <h3>
                {showAccepted
                  ? `Accepted revision ${workflow.acceptedRevision}`
                  : 'Candidate — accepted data unchanged'}
              </h3>
              {dataset.issues.map((issue, i) => (
                <p className="im-error" key={i}>
                  {issue}
                </p>
              ))}
              {dataset.tables.map((table) => (
                <div className="im-research-table" key={table.id}>
                  <h3>
                    {table.name} · {table.rows.length} rows
                  </h3>
                  <p>{table.rowMeaning}</p>
                  <small>
                    Showing first 100 rows. Click a cell to inspect its evidence
                    {showAccepted ? ' or record a correction' : ''}.
                  </small>
                  <div className="im-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {table.columns.map((c) => (
                            <th key={c.id}>
                              {c.name}
                              <small>{c.type}</small>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {table.rows.slice(0, 100).map((row) => (
                          <tr key={row.id}>
                            {table.columns.map((column) => {
                              const c = row.cells[column.id]
                              const prior = accepted?.tables
                                .find((t) => t.id === table.id)
                                ?.rows.find((r) => r.id === row.id)?.cells[column.id]
                              return (
                                <td key={column.id}>
                                  <button
                                    className={c?.missingReason ? 'im-cell-missing' : ''}
                                    title={
                                      !showAccepted && prior && prior.value !== c?.value
                                        ? `Previous accepted value: ${String(prior.value ?? 'missing')}`
                                        : c?.origin
                                    }
                                    onClick={() => {
                                      setSelectedCell({ table, row, column: column.id })
                                      setInspection(null)
                                      setCorrection(String(c?.value ?? ''))
                                      setReason('')
                                    }}
                                  >
                                    {String(c?.value ?? 'Missing')}
                                    {c?.origin === 'manual' && <small>Manual override</small>}
                                  </button>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
          {selectedCell && (
            <aside className="im-cell-inspector">
              <h3>
                {selectedCell.column} · record {selectedCell.row.id.slice(0, 8)}
              </h3>
              <p>
                Value: {String(selectedCell.row.cells[selectedCell.column].value ?? 'Missing')} ·{' '}
                {selectedCell.row.cells[selectedCell.column].origin}
              </p>
              {!showAccepted && (
                <p>
                  Previous accepted value:{' '}
                  {String(
                    accepted?.tables
                      .find((t) => t.id === selectedCell.table.id)
                      ?.rows.find((r) => r.id === selectedCell.row.id)?.cells[selectedCell.column]
                      ?.value ?? 'No accepted value',
                  )}
                  . Persistent manual overrides shown in the candidate take precedence over incoming
                  source values.
                </p>
              )}
              {selectedCell.row.cells[selectedCell.column].missingReason && (
                <p role="alert">{selectedCell.row.cells[selectedCell.column].missingReason}</p>
              )}
              {selectedCell.row.cells[selectedCell.column].origin === 'manual' && (
                <p>
                  Manual override: source excerpts retain incoming facts. The reviewer correction
                  takes precedence in the accepted value.
                </p>
              )}
              {selectedCell.row.cells[selectedCell.column].issues.map((issue, i) => (
                <p key={i}>{issue}</p>
              ))}
              {!selectedCell.row.cells[selectedCell.column].evidence.length && (
                <p>No source evidence for this cell.</p>
              )}
              {selectedCell.row.cells[selectedCell.column].evidence.map((e, i) => (
                <article key={i}>
                  <strong>
                    {e.sourceName} · {e.locator}
                  </strong>
                  <p>{e.excerpt}</p>
                  <small>
                    {e.uri} · retrieved {e.retrievedAt} · SHA256 {e.sourceVersion}
                  </small>
                  <div className="im-controls">
                    <button onClick={() => void act(() => inspect(e))}>
                      Verify snapshot and locator
                    </button>
                    {!e.locator.startsWith('JSON ') && (
                      <button
                        onClick={() =>
                          void act(() => window.infomonkResearch.openEvidence(project.id, e))
                        }
                      >
                        Open source snapshot
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {inspection && (
                <div role="status">
                  <strong>
                    {inspection.sourceName} · {inspection.locator}
                  </strong>
                  <pre>{inspection.text}</pre>
                </div>
              )}
              {showAccepted && (
                <>
                  <label>
                    Corrected value (empty means missing)
                    <input
                      aria-label="Corrected value"
                      value={correction}
                      onChange={(e) => setCorrection(e.target.value)}
                    />
                  </label>
                  <label>
                    Correction reason
                    <input
                      aria-label="Correction reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={!reason.trim() || busy}
                    onClick={() =>
                      void act(async () => {
                        const type = selectedCell.table.columns.find(
                          (c) => c.id === selectedCell.column,
                        )?.type
                        await window.infomonkResearch.correct(
                          project.id,
                          workflow.id,
                          selectedCell.table.id,
                          selectedCell.row.id,
                          selectedCell.column,
                          correction === ''
                            ? null
                            : type === 'number'
                              ? Number(correction)
                              : correction,
                          reason,
                        )
                        setAccepted(await window.infomonkResearch.accepted(project.id, workflow.id))
                        setSelectedCell(null)
                      })
                    }
                  >
                    Save persistent correction
                  </button>
                  <p>
                    Corrections create a new accepted revision and survive refresh. Native
                    spreadsheet edits do not silently change the accepted ledger.
                  </p>
                </>
              )}
            </aside>
          )}
          {run?.status === 'review' && !showAccepted && (
            <div className="im-research-publish">
              <label>
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                />
                I reviewed missing facts, conflicts and validation issues
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={removals}
                  onChange={(e) => setRemovals(e.target.checked)}
                />
                Remove absent records after review (manual overrides are retained)
              </label>
              <button
                className="im-primary"
                disabled={busy || run.sample || run.coverage.failed > 0}
                onClick={() =>
                  void act(async () => {
                    await window.infomonkResearch.publish(project.id, run.id, acknowledge, removals)
                    setAccepted(await window.infomonkResearch.accepted(project.id, workflow.id))
                    setShowAccepted(true)
                    setSelectedCell(null)
                  })
                }
              >
                Publish accepted table
              </button>
              {run.coverage.failed > 0 && (
                <p>
                  Incomplete input coverage blocks publication. Fix or remove failed inputs, save a
                  new configuration, then rerun.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
