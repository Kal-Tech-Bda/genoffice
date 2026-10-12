import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  ResearchRun,
  ResearchAbsentPage,
  ResearchCell,
  ResearchReadiness,
  ResearchTableView,
} from '../../../shared/research-api'
import './research.css'
import { isResearchIdentity } from '../../../shared/research-api'
import { InputReadiness } from './InputReadiness'
import { TableFilters } from './TableFilters'
import { HtmlTableInput } from './HtmlTableInput'
import { SourceChecks } from './SourceChecks'
import { JOB_SITES, APPLICATION_STATUSES } from '../../../shared/jobs-api'

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
  jobs: 'Bermuda jobs',
  htmlTables: 'Website tables',
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
export function ResearchPanel({
  project,
  onCreateFrom,
  initialSelection,
}: {
  project: WorkspaceProject
  onCreateFrom: (workflowId: string) => void
  initialSelection?: { workflowId: string; runId: string | null; needsReview?: boolean }
}) {
  const [state, setState] = useState<ResearchState>({
    workflows: [],
    runs: [],
    latestRuns: [],
    executor: '',
    history: { offset: 0, total: 0, limit: 20 },
    freshness: {},
  })
  const [historyOffset, setHistoryOffset] = useState(0)
  const [run, setRun] = useState<ResearchRun | null>(null)
  const [absent, setAbsent] = useState<ResearchAbsentPage | null>(null)
  const absentBasis = useRef('')
  const [editingId, setEditingId] = useState<string | undefined>()
  const [name, setName] = useState(
    project.workspace?.startKind === 'researchWeb' ? 'Public population' : 'Supplier quotes',
  )
  const [config, setConfig] = useState<ResearchConfig>({
    ...initial,
    kind: project.workspace?.startKind === 'researchWeb' ? 'worldbank' : 'quotes',
    sourceIds:
      project.workspace?.sources
        .filter((s) => /\.(pdf|docx|md|txt)$/i.test(s.name))
        .map((s) => s.id) ?? [],
  })
  const [countryText, setCountryText] = useState(initial.countries.join(', '))
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection?.workflowId ?? null)
  const [runId, setRunId] = useState<string | null>(initialSelection?.runId ?? null)
  const [runReload, setRunReload] = useState(0)
  const [accepted, setAccepted] = useState<ResearchDataset | null>(null)
  const [showAccepted, setShowAccepted] = useState(!!initialSelection && !initialSelection.runId)
  const [needsReview, setNeedsReview] = useState(initialSelection?.needsReview ?? false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledge, setAcknowledge] = useState(false)
  const [removals, setRemovals] = useState(false)
  const [selectedCell, setSelectedCell] = useState<{
    table: ResearchTable
    row: ResearchRow
    column: string
    prior: ResearchCell | null
  } | null>(null)
  const [inspection, setInspection] = useState<{
    text: string
    locator: string
    sourceName: string
  } | null>(null)
  const inspectorElement = useRef<HTMLElement>(null)
  const tableElement = useRef<HTMLHeadingElement>(null)
  const publishElement = useRef<HTMLDivElement>(null)
  const cellReturnFocus = useRef<HTMLElement | null>(null)
  const restoreCellFocus = useRef(false)
  useEffect(() => {
    if (!selectedCell) return
    inspectorElement.current?.focus({ preventScroll: true })
    inspectorElement.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedCell])
  useEffect(() => {
    if (selectedCell || busy || !restoreCellFocus.current) return
    restoreCellFocus.current = false
    const target = cellReturnFocus.current?.isConnected
      ? cellReturnFocus.current
      : tableElement.current
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'nearest' })
  }, [selectedCell, busy])
  function closeCellDetails() {
    cellRequest.current++
    restoreCellFocus.current = true
    setSelectedCell(null)
    setInspection(null)
  }
  const [correction, setCorrection] = useState('')
  const [reason, setReason] = useState('')
  const [schedule, setSchedule] = useState('manual')
  const [allJobFields, setAllJobFields] = useState(false)
  const [viewState, setViewState] = useState<{
    workflowId: string
    view: ResearchTableView
  } | null>(null)
  const [readiness, setReadiness] = useState<ResearchReadiness | null>(null)
  const [checkingInputs, setCheckingInputs] = useState(false)
  const readinessRequest = useRef(0)
  const readinessElement = useRef<HTMLDivElement>(null)
  const configElement = useRef<HTMLDetailsElement>(null)
  const workflow = state.workflows.find((w) => w.id === selectedId)
  const activeView = useMemo(
    () =>
      viewState?.workflowId === selectedId
        ? { ...viewState.view, changesOnly: showAccepted ? false : viewState.view.changesOnly }
        : undefined,
    [viewState, selectedId, showAccepted],
  )
  const pending = state.latestRuns.find(
    (r) =>
      r.workflowId === selectedId &&
      ['queued', 'acquiring', 'processing', 'review'].includes(r.status),
  )
  const scopeEmpty =
    workflow &&
    (workflow.config.kind === 'quotes'
      ? !workflow.config.sourceIds.length
      : workflow.config.kind === 'jobs'
        ? !workflow.config.jobSiteIds?.length
        : workflow.config.kind === 'htmlTables'
          ? !workflow.config.htmlTables?.selections.length
          : !workflow.config.countries.length ||
            (workflow.config.kind === 'enrich' && !workflow.config.parentWorkflowId))
  const identityCell =
    selectedCell &&
    (isResearchIdentity(selectedCell.table.id, selectedCell.column) ||
      workflow?.config.htmlTables?.selections.some(
        (s) => s.tableId === selectedCell.table.id && s.keyColumns.includes(selectedCell.column),
      ))
  const htmlInputReady =
    config.kind !== 'htmlTables' ||
    (!!(config.htmlTables?.url || config.htmlTables?.sourceId) &&
      !!config.htmlTables?.selections.length &&
      config.htmlTables.selections.every(
        (s) => s.keyColumns.length > 0 && s.confirmFirstRowAsHeader !== false,
      ))
  const readinessCurrent =
    !!readiness &&
    readiness.workflowId === selectedId &&
    readiness.configVersion === workflow?.configVersion &&
    readiness.sourceSignature === state.freshness[selectedId ?? '']?.sourceSignature
  useEffect(
    () => () => {
      readinessRequest.current++
    },
    [],
  )
  useEffect(
    () => setSchedule(workflow?.scheduleMinutes?.toString() ?? 'manual'),
    [workflow?.scheduleMinutes, selectedId],
  )
  const runSummary =
    state.runs.find((r) => r.id === runId) ?? state.latestRuns.find((r) => r.id === runId)
  const detailVersion = runId
    ? `${runId}:${runSummary?.updatedAt ?? ''}:${workflow?.acceptedRevision ?? 0}:${state.freshness[workflow?.id ?? '']?.sourceSignature ?? ''}`
    : ''
  const query = useRef({ offset: historyOffset, workflowId: selectedId })
  query.current = { offset: historyOffset, workflowId: selectedId }
  const requestNumber = useRef(0)
  const cellRequest = useRef(0)
  const pageRequest = useRef(0)
  const dataset = showAccepted ? accepted : run?.candidate
  function showRun(id: string | null) {
    pageRequest.current++
    setRunId(id)
    setRunReload((value) => value + 1)
    setRun(null)
    setAbsent(null)
    absentBasis.current = ''
    cellRequest.current++
    setShowAccepted(false)
    setNeedsReview(false)
    setSelectedCell(null)
    setInspection(null)
    setAcknowledge(false)
    setRemovals(false)
  }
  const refresh = useCallback(async () => {
    const request = ++requestNumber.current
    const value = await window.infomonkResearch.state(
      project.id,
      query.current.offset,
      query.current.workflowId ?? undefined,
    )
    if (request === requestNumber.current) setState(value)
  }, [project.id])
  useEffect(() => {
    let live = true
    const requests = requestNumber
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        await refresh()
      } catch (err) {
        if (live) setError(String(err))
      }
      if (live) timer = setTimeout(() => void read(), 1500)
    }
    void read()
    return () => {
      live = false
      clearTimeout(timer)
      requests.current++
    }
  }, [refresh, historyOffset, selectedId])
  useEffect(() => {
    let live = true
    if (!runId) return
    const request = ++pageRequest.current
    void window.infomonkResearch
      .detail(project.id, runId, { needsReview, view: activeView })
      .then((value) => {
        if (live && request === pageRequest.current) {
          setRun(value)
          const basis = `${value.id}:${value.updatedAt}:${workflow?.acceptedRevision ?? 0}`
          if (basis !== absentBasis.current) {
            absentBasis.current = basis
            setAbsent(null)
          }
        }
      })
      .catch((err) => {
        if (live) setError(String(err))
      })
    return () => {
      live = false
    }
  }, [
    project.id,
    runId,
    runReload,
    detailVersion,
    needsReview,
    workflow?.acceptedRevision,
    activeView,
  ])
  useEffect(() => {
    let live = true
    if (!showAccepted || !selectedId) return
    const request = ++pageRequest.current
    void window.infomonkResearch
      .accepted(project.id, selectedId, { needsReview, view: activeView })
      .then((value) => {
        if (live && request === pageRequest.current) setAccepted(value)
      })
      .catch((err) => {
        if (live) setError(String(err))
      })
    return () => {
      live = false
    }
  }, [project.id, selectedId, showAccepted, needsReview, workflow?.acceptedRevision, activeView])
  async function selectCell(table: ResearchTable, row: ResearchRow, column: string) {
    if (!workflow) return
    restoreCellFocus.current = false
    cellReturnFocus.current = document.activeElement as HTMLElement | null
    const request = ++cellRequest.current
    const result = await window.infomonkResearch.cell(
      project.id,
      workflow.id,
      showAccepted ? null : runId,
      table.id,
      row.id,
      column,
    )
    if (request !== cellRequest.current) return
    setSelectedCell({
      table,
      row: { ...row, cells: { ...row.cells, [column]: result.cell } },
      column,
      prior: result.prior,
    })
    setInspection(null)
    setCorrection(String(result.cell.value ?? ''))
    setReason(table.id === 'jobs' ? 'Personal tracking update from the job tracker' : '')
  }
  async function pageTable(tableId: string, offset: number) {
    if (!workflow) return
    const request = ++pageRequest.current
    cellRequest.current++
    const page = showAccepted
      ? await window.infomonkResearch.accepted(project.id, workflow.id, {
          tableId,
          offset,
          needsReview,
          view: activeView,
        })
      : (
          await window.infomonkResearch.detail(project.id, runId!, {
            tableId,
            offset,
            needsReview,
            view: activeView,
          })
        ).candidate
    if (request !== pageRequest.current) return
    const merge = (current: ResearchDataset | null) =>
      current && page
        ? {
            ...current,
            tables: current.tables.map((t) => page.tables.find((p) => p.id === t.id) ?? t),
          }
        : current
    if (showAccepted) setAccepted(merge)
    else setRun((current) => (current ? { ...current, candidate: merge(current.candidate) } : null))
    cellRequest.current++
    setSelectedCell(null)
    setInspection(null)
  }
  async function applyView(view: ResearchTableView) {
    if (!workflow) return
    pageRequest.current++
    cellRequest.current++
    setSelectedCell(null)
    setInspection(null)
    setNeedsReview(false)
    setViewState({ workflowId: workflow.id, view })
  }
  async function shortlist(row: ResearchRow) {
    if (!workflow || !showAccepted) return
    await window.infomonkResearch.correct(
      project.id,
      workflow.id,
      'jobs',
      row.id,
      'application_status',
      'Saved',
      'Saved to shortlist from the job tracker; no application sent',
    )
    setAccepted(
      await window.infomonkResearch.accepted(project.id, workflow.id, {
        needsReview,
        view: activeView,
      }),
    )
  }
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
    readinessRequest.current++
    setReadiness(null)
    setSelectedId(w.id)
    setHistoryOffset(0)
    showRun(state.latestRuns.find((r) => r.workflowId === w.id)?.id ?? null)
    setAccepted(await window.infomonkResearch.accepted(project.id, w.id))
    const latest = state.latestRuns.find((r) => r.workflowId === w.id)
    setShowAccepted(w.acceptedRevision > 0 && (!latest || latest.status === 'published'))
    setSchedule(w.scheduleMinutes?.toString() ?? 'manual')
  }
  function edit(w: ResearchWorkflow) {
    setEditingId(w.id)
    setName(w.name)
    setConfig(w.config)
    setCountryText(w.config.countries.join(', '))
    requestAnimationFrame(() => configElement.current?.scrollIntoView({ block: 'start' }))
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
    readinessRequest.current++
    setReadiness(null)
    setHistoryOffset(0)
    setEditingId(undefined)
    showRun(null)
    setAccepted(await window.infomonkResearch.accepted(project.id, w.id))
    setSchedule(w.scheduleMinutes?.toString() ?? 'manual')
  }
  async function checkInputs(reveal = false) {
    if (!workflow) return null
    const request = ++readinessRequest.current
    setCheckingInputs(true)
    try {
      const report = await window.infomonkResearch.readiness(project.id, workflow.id)
      if (request !== readinessRequest.current || query.current.workflowId !== report.workflowId)
        return null
      setReadiness(report)
      if (reveal || !report.readyToRun)
        requestAnimationFrame(() => readinessElement.current?.scrollIntoView({ block: 'start' }))
      return report
    } finally {
      if (request === readinessRequest.current) setCheckingInputs(false)
    }
  }
  async function start(sample: boolean) {
    if (!workflow) return
    if (!sample && workflow.config.kind === 'quotes') {
      const report = await checkInputs()
      if (!report || !report.readyToRun) return
    }
    const next = await window.infomonkResearch.run(project.id, workflow.id, sample)
    setHistoryOffset(0)
    showRun(next.id)
  }
  async function inspect(e: Evidence) {
    setInspection(await window.infomonkResearch.evidence(project.id, e))
  }
  return (
    <section className="im-research">
      <p className="im-muted">
        Build a traceable table, inspect a sample, then process all confirmed inputs. Supported
        sources: labeled supplier quotes, World Bank population, ordinary HTML tables and selected
        Bermuda career sites. Every refresh creates a candidate for review.
      </p>
      {error && (
        <p role="alert" className="im-error">
          {error}
        </p>
      )}
      <details
        ref={configElement}
        className="im-research-config"
        open={!!editingId || !state.workflows.length}
      >
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
            onChange={(e) => {
              const kind = e.target.value as ResearchConfig['kind']
              setConfig({ ...config, kind })
              if (['Supplier quotes', 'Public population'].includes(name)) setName(taskNames[kind])
            }}
          >
            <option value="quotes">Supplier quotes → structured sheets</option>
            <option value="worldbank">World Bank population → research table</option>
            <option value="enrich">Enrich accepted quotes by country code</option>
            <option value="jobs">Bermuda jobs → manual tracker</option>
            <option value="htmlTables">Website tables → maintained sheets</option>
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
        ) : config.kind === 'htmlTables' ? (
          <HtmlTableInput
            key={editingId ?? 'new'}
            project={project}
            config={config}
            onChange={setConfig}
          />
        ) : config.kind === 'jobs' ? (
          <>
            <p>
              Search job boards, recruiters and employer portals for technology, data and office
              roles. Title rules distinguish technology, data/research, office/finance and adjacent
              quantitative roles. Uncertain locations, mixed-role advertisements, seasonal intakes
              and talent pools require review. Counts describe source listings, not distinct current
              vacancies.
            </p>
            <p>
              Only public listing/detail URLs are fetched. No login, résumé, application or paid
              provider request is sent. Missing deadlines/employers and conflicting locations stay
              visible. Job facts are read-only; application status and notes persist through
              refresh.
            </p>
            <fieldset>
              <legend>Confirmed job websites</legend>
              <div className="im-controls">
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, jobSiteIds: JOB_SITES.map((s) => s.id) })}
                >
                  Select all supported websites
                </button>
                <button type="button" onClick={() => setConfig({ ...config, jobSiteIds: [] })}>
                  Clear website selection
                </button>
              </div>
              {JOB_SITES.map((site) => (
                <label key={site.id}>
                  <input
                    type="checkbox"
                    checked={config.jobSiteIds?.includes(site.id) ?? false}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        jobSiteIds: e.target.checked
                          ? [...(config.jobSiteIds ?? []), site.id]
                          : (config.jobSiteIds ?? []).filter((id) => id !== site.id),
                      })
                    }
                  />
                  {site.name} · {site.url}
                </label>
              ))}
            </fieldset>
            <p>
              Manual refresh checks the selected pages again, then stops for review. A failed or
              changed page cannot replace the accepted tracker. A disappearing listing is retained
              for review; absence does not establish closure. Agency title/location keys cannot
              reliably distinguish reposts.
            </p>
            <p>
              Source checks also lists discovery targets that need manual search or another adapter.
              Unsearched targets have null counts, never zero-job results. A publication expiry date
              is stored separately from an employer deadline. This search does not include
              authenticated portals. Completed inputs mean the configured public view was checked;
              partial searches do not establish whole-site coverage.
            </p>
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
          disabled={busy || !name.trim() || !htmlInputReady}
          className="im-primary"
          onClick={() => void act(save)}
        >
          {editingId ? 'Save new configuration version' : 'Save workflow'}
        </button>
      </details>
      <div className="im-workflow-cards">
        {state.workflows.map((w) => {
          const latest = state.latestRuns.find((r) => r.workflowId === w.id)
          return (
            <article key={w.id} className={selectedId === w.id ? 'selected' : ''}>
              <button
                disabled={busy}
                className="im-workflow-title"
                onClick={() => void act(() => select(w))}
              >
                {w.name}
              </button>
              <p>
                {taskNames[w.config.kind]} · configuration {w.configVersion} · accepted revision{' '}
                {w.acceptedRevision}
              </p>
              <small>
                {w.config.kind === 'quotes'
                  ? `${w.config.sourceIds.length} input snapshots`
                  : w.config.kind === 'jobs'
                    ? `${w.config.jobSiteIds?.length ?? 0} confirmed job websites · manual refresh`
                    : w.config.kind === 'htmlTables'
                      ? `${w.config.htmlTables?.selections.length ?? 0} confirmed tables · ${w.config.htmlTables?.url ? new URL(w.config.htmlTables.url).hostname : 'saved HTML snapshot'}`
                      : `${w.config.countries.join(', ')} / ${w.config.fromYear}–${w.config.toYear}`}
              </small>
              <p>{latest ? `${latest.status}: ${latest.progress}` : 'No runs yet'}</p>
              {w.acceptedRevision > 0 && (
                <p className="im-muted">
                  Accepted {new Date(state.freshness[w.id]?.acceptedAt ?? '').toLocaleString()} ·{' '}
                  {state.freshness[w.id]?.inputsChanged ||
                  state.freshness[w.id]?.configurationChanged
                    ? 'Inputs or configuration changed · run a reviewed refresh'
                    : w.config.kind === 'worldbank' ||
                        (w.config.kind === 'htmlTables' && w.config.htmlTables?.url)
                      ? 'Public snapshot · refresh to check for new observations'
                      : 'Selected input snapshots match the accepted run'}
                </p>
              )}
              <small>
                Destination: {w.destination?.split(/[\\/]/).pop() ?? 'New reviewed XLSX revision'} ·{' '}
                {w.paused
                  ? 'Schedule paused'
                  : w.scheduleMinutes
                    ? `Every ${w.scheduleMinutes} minutes while app is open`
                    : 'Manual trigger'}
              </small>
              <div className="im-controls">
                {latest?.status === 'review' && (
                  <button disabled={busy} onClick={() => void act(() => select(w))}>
                    Review candidate
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => {
                    edit(w)
                    void act(() => select(w))
                  }}
                >
                  Edit
                </button>
                <button
                  disabled={busy}
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
                <button disabled={busy} onClick={() => onCreateFrom(w.id)}>
                  Start a new project from this workflow
                </button>
              </div>
            </article>
          )
        })}
      </div>
      {workflow && (
        <>
          <h2>{workflow.name}</h2>
          {workflow.config.kind === 'quotes' && (
            <div ref={readinessElement}>
              <InputReadiness
                report={readiness}
                current={readinessCurrent}
                busy={busy}
                editing={editingId === workflow.id}
                checking={checkingInputs}
                onCheck={() =>
                  void act(async () => {
                    await checkInputs(true)
                  })
                }
                onEdit={() => edit(workflow)}
                onOpen={(sourceId, version) =>
                  void act(() => window.infomonk.openSource(project.id, sourceId, version))
                }
              />
            </div>
          )}
          {scopeEmpty && (
            <p role="status">
              This workflow needs confirmed inputs before it can run.{' '}
              <button disabled={busy} onClick={() => edit(workflow)}>
                Choose workflow inputs
              </button>
            </p>
          )}
          {showAccepted &&
            (state.freshness[workflow.id]?.inputsChanged ||
              state.freshness[workflow.id]?.configurationChanged) && (
              <p className="im-muted">
                These accepted values use earlier inputs or configuration. Run all confirmed inputs
                to review a fresh candidate.
              </p>
            )}
          <div className="im-controls">
            <button
              disabled={busy || !!pending || !!scopeEmpty || editingId === workflow.id}
              onClick={() => void act(() => start(true))}
            >
              Run sample
            </button>
            <button
              className="im-primary"
              disabled={
                busy ||
                !!scopeEmpty ||
                editingId === workflow.id ||
                (readinessCurrent && !readiness!.readyToRun) ||
                (!!pending && !(pending.sample && pending.status === 'review'))
              }
              onClick={() => void act(() => start(false))}
            >
              {workflow.config.kind === 'jobs' && workflow.acceptedRevision
                ? 'Refresh job listings'
                : workflow.config.kind === 'htmlTables' && workflow.acceptedRevision
                  ? 'Refresh website tables'
                  : 'Run all confirmed inputs'}
            </button>
            <button
              disabled={!workflow.destination || busy}
              onClick={() => void act(() => window.infomonkResearch.open(project.id, workflow.id))}
            >
              Open accepted workbook
            </button>
            <button
              disabled={!workflow.acceptedRevision || busy}
              onClick={() =>
                void act(async () => {
                  setAccepted(
                    await window.infomonkResearch.accepted(project.id, workflow.id, {
                      needsReview,
                    }),
                  )
                  setShowAccepted(true)
                  setSelectedCell(null)
                  cellRequest.current++
                })
              }
            >
              Inspect accepted table
            </button>
            {dataset && (
              <button
                onClick={() => {
                  tableElement.current?.focus({ preventScroll: true })
                  tableElement.current?.scrollIntoView({ block: 'start' })
                }}
              >
                Go to table
              </button>
            )}
            {run?.status === 'review' && !showAccepted && (
              <button
                onClick={() => {
                  publishElement.current?.focus({ preventScroll: true })
                  publishElement.current?.scrollIntoView({ block: 'nearest' })
                }}
              >
                Review and publish
              </button>
            )}
          </div>
          {pending && !(pending.sample && pending.status === 'review') && (
            <p className="im-muted">
              {pending.status === 'review'
                ? 'Review and publish this full candidate, edit its configuration, or cancel it before starting another run.'
                : 'The current run must finish or be cancelled before starting another run.'}
            </p>
          )}
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
              disabled={busy}
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
              disabled={busy || !workflow.scheduleMinutes}
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
            <div className="im-controls">
              <span>
                {state.history.total} runs · page {Math.floor(historyOffset / 20) + 1}
              </span>
              <button
                disabled={historyOffset === 0 || busy}
                onClick={() => setHistoryOffset(Math.max(0, historyOffset - 20))}
              >
                Previous runs
              </button>
              <button
                disabled={historyOffset + 20 >= state.history.total || busy}
                onClick={() => setHistoryOffset(historyOffset + 20)}
              >
                Older runs
              </button>
            </div>
            {state.runs
              .filter((r) => r.workflowId === workflow.id)
              .map((r) => (
                <article className="im-run-row" key={r.id}>
                  <button disabled={busy} onClick={() => showRun(r.id)}>
                    {new Date(r.createdAt).toLocaleString()} · {r.sample ? 'sample' : 'full'} ·{' '}
                    {r.status}
                  </button>
                  <span>
                    {r.progress} · {r.coverage.complete}/{r.coverage.total} complete ·{' '}
                    {r.coverage.failed} failed
                  </span>
                  {['queued', 'acquiring', 'processing', 'review'].includes(r.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(() => window.infomonkResearch.cancel(project.id, r.id))
                      }
                    >
                      Cancel run
                    </button>
                  )}
                  {['failed', 'cancelled'].includes(r.status) && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          showRun((await window.infomonkResearch.retry(project.id, r.id)).id)
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
          {run &&
            !showAccepted &&
            (run.jobChanges ? (
              <section className="im-refresh-summary" aria-label="Job refresh summary">
                <h3>
                  {run.sample ? 'Sample listing changes' : 'Listing changes since accepted data'}
                </h3>
                <div className="im-refresh-counts" role="status">
                  <span>
                    <strong>{run.jobChanges.added}</strong> new listings
                  </span>
                  <span>
                    <strong>{run.jobChanges.changed}</strong> fact changes
                  </span>
                  <span>
                    <strong>{run.jobChanges.notFound}</strong> newly not found
                  </span>
                  <span>
                    <strong>{run.jobChanges.returned}</strong> returned
                  </span>
                  <span>
                    <strong>{run.jobChanges.unchanged}</strong> unchanged
                  </span>
                  <span>
                    <strong>{run.jobChanges.outsideSources}</strong> outside selected sources
                  </span>
                </div>
                <p className="im-muted">
                  A new check time or snapshot does not count as a vacancy-fact change. Not found
                  does not mean closed. Personal tracking retained for{' '}
                  {run.jobChanges.trackingPreserved} listings.
                </p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      applyView({
                        ...(activeView ?? { tableId: 'jobs' }),
                        changesOnly: !activeView?.changesOnly,
                      }),
                    )
                  }
                >
                  {activeView?.changesOnly ? 'Show all matching listings' : 'Show refresh changes'}
                </button>
              </section>
            ) : (
              <p role="status">
                {run.status} · {run.progress} · added {run.changes.added}, changed{' '}
                {run.changes.changed}, absent {run.changes.removed}.{' '}
                {run.sample &&
                  'Sample only; cannot publish. Inspect the sample, adjust the configuration if needed, then run all confirmed inputs. The sample stays in history.'}
              </p>
            ))}
          {run?.inputsChanged && !showAccepted && (
            <p role="alert" className="im-error">
              Source inputs changed since this run. Accepted data is unchanged. Cancel this
              candidate and run again with the current snapshots.
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
          {run?.candidate && !showAccepted && workflow.acceptedRevision > 0 && (
            <details
              onToggle={(event) => {
                if (event.currentTarget.open && !absent)
                  void act(async () =>
                    setAbsent(await window.infomonkResearch.absent(project.id, run.id)),
                  )
              }}
            >
              <summary>Records absent from this acquisition · {run.changes.removed}</summary>
              {absent?.rows.map(({ table, row }) => (
                <p key={`${table}:${row.id}`}>
                  {table} · {row.id.slice(0, 8)} ·{' '}
                  {Object.values(row.cells)
                    .map((c) => String(c.value ?? 'Missing'))
                    .join(' / ')}
                </p>
              ))}
              {absent && (
                <div className="im-controls">
                  <span>{absent.total} absent records</span>
                  <button
                    disabled={busy || absent.offset === 0}
                    onClick={() =>
                      void act(async () =>
                        setAbsent(
                          await window.infomonkResearch.absent(
                            project.id,
                            run.id,
                            Math.max(0, absent.offset - 100),
                          ),
                        ),
                      )
                    }
                  >
                    Previous absent records
                  </button>
                  <button
                    disabled={busy || absent.offset + 100 >= absent.total}
                    onClick={() =>
                      void act(async () =>
                        setAbsent(
                          await window.infomonkResearch.absent(
                            project.id,
                            run.id,
                            absent.offset + 100,
                          ),
                        ),
                      )
                    }
                  >
                    Next absent records
                  </button>
                </div>
              )}
              <p>
                Absence is not proof of intentional deletion. Retain by default; the reviewed
                removal option controls publication. Overridden records remain.
              </p>
            </details>
          )}
          {run?.htmlContextChanged && !showAccepted && (
            <p role="status" className="im-source-context">
              Source context notes changed. Review them even when row facts are unchanged; accepted
              notes stay intact until publication.
            </p>
          )}
          {dataset && (
            <>
              <h3 ref={tableElement} tabIndex={-1}>
                {showAccepted
                  ? `Accepted revision ${workflow.acceptedRevision}`
                  : run?.status === 'published'
                    ? 'Published run with current manual overrides'
                    : 'Candidate — accepted data unchanged'}
              </h3>
              <label>
                <input
                  type="checkbox"
                  checked={needsReview}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.checked
                    void act(async () => {
                      setNeedsReview(next)
                      cellRequest.current++
                      setSelectedCell(null)
                      setInspection(null)
                      if (showAccepted)
                        setAccepted(
                          await window.infomonkResearch.accepted(project.id, workflow.id, {
                            needsReview: next,
                            view: activeView,
                          }),
                        )
                      else if (runId)
                        setRun(
                          await window.infomonkResearch.detail(project.id, runId, {
                            needsReview: next,
                            view: activeView,
                          }),
                        )
                    })
                  }}
                />{' '}
                Show rows needing review
              </label>
              {needsReview && (
                <p className="im-muted">
                  Shows rows with missing values or validation issues across the complete table.
                  Manual changes remain labeled. Filtering does not alter publication or accepted
                  records.
                </p>
              )}
              {dataset.issues.length > 0 && (
                <details className="im-source-context" open={workflow.config.kind === 'htmlTables'}>
                  <summary>Source context and validation notes · {dataset.issues.length}</summary>
                  {dataset.issues.map((issue, i) => (
                    <p className="im-muted" key={i}>
                      {issue}
                    </p>
                  ))}
                </details>
              )}
              {dataset.tables.map((table) =>
                table.id === 'job_sources' ? (
                  <div className="im-research-table" key={table.id}>
                    <SourceChecks
                      key={workflow.id}
                      table={table}
                      busy={busy}
                      onInspect={(row, column) => void act(() => selectCell(table, row, column))}
                    />
                    {(table.totalRows ?? table.rows.length) > 100 && (
                      <div className="im-controls">
                        <button
                          disabled={busy || !table.offset}
                          onClick={() =>
                            void act(() =>
                              pageTable(table.id, Math.max(0, (table.offset ?? 0) - 100)),
                            )
                          }
                        >
                          Previous {table.name} rows
                        </button>
                        <button
                          disabled={
                            busy ||
                            (table.offset ?? 0) + 100 >= (table.totalRows ?? table.rows.length)
                          }
                          onClick={() =>
                            void act(() => pageTable(table.id, (table.offset ?? 0) + 100))
                          }
                        >
                          Next {table.name} rows
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className={`im-research-table ${table.id === 'jobs' ? 'im-jobs-table' : ''}`}
                    key={table.id}
                  >
                    <h3 aria-live="polite">
                      {table.name} · {table.totalRows ?? table.rows.length}
                      {needsReview
                        ? ` of ${table.allRows ?? table.totalRows} rows need review`
                        : activeView?.tableId === table.id
                          ? ` of ${table.allRows ?? table.totalRows} rows`
                          : ' rows'}
                    </h3>
                    <p>{table.rowMeaning}</p>
                    {table.id === 'jobs' && (
                      <TableFilters
                        key={workflow.id}
                        reviewOnly={needsReview}
                        projectId={project.id}
                        workflowId={workflow.id}
                        table={table}
                        view={activeView?.tableId === table.id ? activeView : undefined}
                        busy={busy}
                        onApply={(view) => act(() => applyView(view))}
                      />
                    )}
                    <small>
                      Showing rows {(table.offset ?? 0) + (table.rows.length ? 1 : 0)}–
                      {(table.offset ?? 0) + table.rows.length}. Click a cell to inspect its
                      evidence
                      {showAccepted
                        ? table.id === 'jobs'
                          ? '; update your tracking status or notes in their own fields'
                          : ' or record a correction'
                        : ''}
                      .
                    </small>
                    <div className="im-controls">
                      {table.id === 'jobs' && (
                        <button disabled={busy} onClick={() => setAllJobFields(!allJobFields)}>
                          {allJobFields ? 'Show compact job tracker' : 'Show all job fields'}
                        </button>
                      )}
                      {(table.totalRows ?? table.rows.length) > 100 && (
                        <>
                          <button
                            disabled={busy || !table.offset}
                            onClick={() =>
                              void act(() =>
                                pageTable(table.id, Math.max(0, (table.offset ?? 0) - 100)),
                              )
                            }
                          >
                            Previous {table.name} rows
                          </button>
                          <button
                            disabled={
                              busy ||
                              (table.offset ?? 0) + 100 >= (table.totalRows ?? table.rows.length)
                            }
                            onClick={() =>
                              void act(() => pageTable(table.id, (table.offset ?? 0) + 100))
                            }
                          >
                            Next {table.name} rows
                          </button>
                        </>
                      )}
                    </div>
                    <div
                      className="im-table-scroll"
                      tabIndex={0}
                      aria-label={`${table.name} table scroll area`}
                    >
                      <table aria-label={table.name}>
                        <thead>
                          <tr>
                            {table.columns
                              .filter(
                                (c) =>
                                  table.id !== 'jobs' ||
                                  allJobFields ||
                                  [
                                    'title',
                                    'location',
                                    'closing_date',
                                    'listing_status',
                                    'application_status',
                                    'notes',
                                  ].includes(c.id),
                              )
                              .map((c) => (
                                <th key={c.id} scope="col" title={`Field type: ${c.type}`}>
                                  {c.name}
                                </th>
                              ))}
                          </tr>
                        </thead>
                        <tbody>
                          {table.rows.length === 0 && (
                            <tr className="im-empty-view">
                              <td colSpan={table.columns.length}>
                                No rows match this view.{' '}
                                {table.id === 'jobs'
                                  ? 'Adjust the filters or choose All listings.'
                                  : 'Clear Show rows needing review to see all records.'}{' '}
                                Accepted records remain intact.
                              </td>
                            </tr>
                          )}
                          {table.rows.slice(0, 100).map((row) => (
                            <tr key={row.id}>
                              {table.columns
                                .filter(
                                  (c) =>
                                    table.id !== 'jobs' ||
                                    allJobFields ||
                                    [
                                      'title',
                                      'location',
                                      'closing_date',
                                      'listing_status',
                                      'application_status',
                                      'notes',
                                    ].includes(c.id),
                                )
                                .map((column) => {
                                  const c = row.cells[column.id]
                                  const prior = accepted?.tables
                                    .find((t) => t.id === table.id)
                                    ?.rows.find((r) => r.id === row.id)?.cells[column.id]
                                  return (
                                    <td
                                      key={column.id}
                                      className={
                                        table.id === 'jobs' && column.type === 'date'
                                          ? 'im-job-date'
                                          : undefined
                                      }
                                    >
                                      <button
                                        disabled={busy}
                                        className={c?.missingReason ? 'im-cell-missing' : ''}
                                        title={
                                          !showAccepted && prior && prior.value !== c?.value
                                            ? `Previous accepted value: ${String(prior.value ?? 'missing')}`
                                            : c?.origin
                                        }
                                        onClick={() =>
                                          void act(() => selectCell(table, row, column.id))
                                        }
                                      >
                                        {table.id === 'jobs' &&
                                        column.id === 'notes' &&
                                        c?.value === ''
                                          ? 'Add note'
                                          : String(c?.value ?? 'Missing')}
                                        {c?.origin === 'manual' && <small>Manual override</small>}
                                      </button>
                                      {table.id === 'jobs' &&
                                        !allJobFields &&
                                        column.id === 'title' && (
                                          <small className="im-job-source">
                                            {!showAccepted &&
                                              row.change &&
                                              row.change.kind !== 'unchanged' && (
                                                <span className="im-change-label">
                                                  {row.change.kind.replaceAll('-', ' ')}
                                                  {row.change.fields.length
                                                    ? ` · ${row.change.fields.join(', ')}`
                                                    : ''}
                                                </span>
                                              )}
                                            {row.cells.role_group?.value
                                              ? `${String(row.cells.role_group.value)} · `
                                              : ''}
                                            {String(row.cells.source_site.value)} ·{' '}
                                            {String(
                                              row.cells.employer.value ?? 'Employer not stated',
                                            )}
                                            {row.cells.employer.origin === 'internal' &&
                                              row.cells.employer.value && (
                                                <span> · configured publisher</span>
                                              )}
                                            {showAccepted &&
                                              row.cells.application_status?.value ===
                                                'To review' && (
                                                <button
                                                  className="im-shortlist-action"
                                                  disabled={busy}
                                                  onClick={() => void act(() => shortlist(row))}
                                                >
                                                  Save to shortlist
                                                </button>
                                              )}
                                          </small>
                                        )}
                                    </td>
                                  )
                                })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ),
              )}
            </>
          )}
          {selectedCell && (
            <aside
              ref={inspectorElement}
              className="im-cell-inspector"
              role="region"
              aria-label="Cell details"
              tabIndex={-1}
            >
              <div className="im-inspector-heading">
                <h3>
                  {selectedCell.table.columns.find((c) => c.id === selectedCell.column)?.name ??
                    selectedCell.column}
                </h3>
                <button onClick={closeCellDetails}>Close cell details</button>
              </div>
              {selectedCell.table.id === 'jobs' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(() =>
                      window.infomonkResearch.visitJob(
                        project.id,
                        workflow.id,
                        showAccepted ? null : runId,
                        selectedCell.row.id,
                      ),
                    )
                  }
                >
                  Open live listing
                </button>
              )}
              <p>
                Value: {String(selectedCell.row.cells[selectedCell.column].value ?? 'Missing')} ·{' '}
                {selectedCell.row.cells[selectedCell.column].origin === 'external'
                  ? 'Source value'
                  : selectedCell.row.cells[selectedCell.column].origin === 'manual'
                    ? 'Manual override'
                    : 'Workspace value'}
              </p>
              <details className="im-evidence-technical">
                <summary>Record details</summary>
                <small>
                  {selectedCell.column} · record {selectedCell.row.id}
                </small>
              </details>
              {!showAccepted && (
                <p>
                  Previous accepted value:{' '}
                  {String(selectedCell.prior?.value ?? 'No accepted value')}. Persistent manual
                  overrides shown in the candidate take precedence over incoming source values.
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
                  <strong>{e.sourceName}</strong>
                  <p>{e.excerpt}</p>
                  <details className="im-evidence-technical">
                    <summary>Snapshot details</summary>
                    <small>{e.uri}</small>
                    <small>Retrieved {e.retrievedAt}</small>
                    <small>Locator: {e.locator}</small>
                    <small>SHA256 {e.sourceVersion}</small>
                  </details>
                  <div className="im-controls">
                    <button disabled={busy} onClick={() => void act(() => inspect(e))}>
                      Verify snapshot and locator
                    </button>
                    {!e.locator.startsWith('JSON ') && !e.locator.startsWith('HTML ') && (
                      <button
                        disabled={busy}
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
              {showAccepted && identityCell && (
                <p>
                  {workflow.config.kind === 'jobs' ? (
                    'Source facts and observation dates are read-only. Refresh the selected websites to review changes. Track your own application status and notes in their separate fields.'
                  ) : (
                    <>
                      This field defines record identity and links related rows. To change it,
                      update the source or confirmed scope and review a new run. Ordinary cell
                      corrections cannot change record keys.
                    </>
                  )}
                </p>
              )}
              {showAccepted && !identityCell && (
                <>
                  <label>
                    {selectedCell.table.id === 'jobs'
                      ? selectedCell.column === 'application_status'
                        ? 'Application status'
                        : 'My notes'
                      : 'Corrected value (empty means missing)'}
                    {selectedCell.table.id === 'jobs' &&
                    selectedCell.column === 'application_status' ? (
                      <select
                        aria-label="Corrected value"
                        value={correction}
                        onChange={(e) => setCorrection(e.target.value)}
                      >
                        {APPLICATION_STATUSES.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label="Corrected value"
                        value={correction}
                        onChange={(e) => setCorrection(e.target.value)}
                      />
                    )}
                  </label>
                  <label>
                    {selectedCell.table.id === 'jobs'
                      ? 'Tracking update reason'
                      : 'Correction reason'}
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
                          correction === '' &&
                            !(selectedCell.table.id === 'jobs' && selectedCell.column === 'notes')
                            ? null
                            : type === 'number'
                              ? Number(correction)
                              : correction,
                          reason,
                        )
                        setAccepted(
                          await window.infomonkResearch.accepted(project.id, workflow.id, {
                            needsReview,
                            view: activeView,
                          }),
                        )
                        closeCellDetails()
                      })
                    }
                  >
                    {selectedCell.table.id === 'jobs'
                      ? 'Save tracking update'
                      : 'Save persistent correction'}
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
            <div
              ref={publishElement}
              className="im-research-publish"
              tabIndex={-1}
              role="region"
              aria-label="Publication review"
            >
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
              {run.changes.removed > 0 && (
                <p>
                  Absent rows stay by default. Reviewed removal also retains quotes and related line
                  items protected by a manual correction.
                </p>
              )}
              <button
                className="im-primary"
                disabled={busy || run.sample || run.coverage.failed > 0 || run.inputsChanged}
                onClick={() =>
                  void act(async () => {
                    await window.infomonkResearch.publish(project.id, run.id, acknowledge, removals)
                    setAccepted(
                      await window.infomonkResearch.accepted(project.id, workflow.id, {
                        needsReview,
                        view: activeView ? { ...activeView, changesOnly: false } : undefined,
                      }),
                    )
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
