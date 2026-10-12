import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join, extname, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { writeXlsxAtomically, XLSX_ZIP_LIMITS } from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'
import { assertZipInflatesWithinLimits } from '@genoffice/zip-gate'
import type { WorkspaceStore } from '../workspace-store'
import type {
  CellDetails,
  Evidence,
  EvidenceSelection,
  ResearchConfig,
  ResearchDataset,
  ResearchValue,
  ResearchPageRequest,
  ResearchFreshness,
  ResearchOverview,
  ResearchProjectSummary,
  ResearchWorkflow,
  ResearchReadiness,
  ResearchInputReadiness,
  HtmlTableInput,
  HtmlTableDiscovery,
} from '../../shared/research-api'
import type { WorkspaceProject } from '../../shared/workspace-api'
import { ResearchStore, type DurableInput } from './store'
import {
  cell,
  extractQuote,
  hash,
  mergeDatasets,
  parseSource,
  PROCESSING_VERSION,
  diffHtmlTables,
  htmlContextChanged,
  type ParsedSource,
} from './extract'
import { fetchPopulation, parsePopulation, worldBankUrl } from './worldbank'
import { projectDataset } from './projection'
import { datasetPage, previewCell } from './pages'
import { jobChanges } from './job-changes'
import { parseHtmlTables, htmlTablesDataset, type ParsedHtmlTables } from './html-tables'
import { fetchTableSource, tableSourceUrl } from './table-fetch'
import { RESEARCH_METADATA_LIMIT } from './metadata'
import { isResearchIdentity } from '../../shared/research-api'
import { APPLICATION_STATUSES, JOB_SITES } from '../../shared/jobs-api'
import { exportTarget, workspaceExportProtectedPaths } from '../export-target'
import {
  jobSite,
  jobUrl,
  jobStartUrl,
  parseJobPage,
  fetchJobPage,
  jobDataset,
  type JobPage,
  type JobObservation,
} from './jobs'
import {
  addFinding,
  duplicateKeyFindings,
  finding,
  quoteFindings,
  READINESS_PARSE_CACHE_BYTES,
} from './readiness'

export class ResearchService {
  readonly store: ResearchStore
  private running = false
  private controller: AbortController | null = null
  private activeRun: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private checkingInputs = false
  private parsedInputs = new Map<string, string>()
  private parsedInputBytes = 0
  private tableCaptures = new Map<
    string,
    {
      projectId: string
      input: HtmlTableInput
      durable: DurableInput
      parsed: ParsedHtmlTables
      created: number
      usedByFullRun: boolean
    }
  >()
  private tableDiscoveries = new Set<AbortController>()
  constructor(
    private readonly userData: string,
    readonly workspace: WorkspaceStore,
  ) {
    this.store = new ResearchStore(join(userData, 'infomonk-research.sqlite'))
  }
  start(): void {
    this.timer = setInterval(() => this.tick(), 30_000)
    this.timer.unref()
    this.tick()
  }
  close(): void {
    if (this.timer) clearInterval(this.timer)
    this.controller?.abort() /* SQLite stays open until Electron exits; interrupted work is fenced on next startup. */
    this.parsedInputs.clear()
    this.parsedInputBytes = 0
    for (const controller of this.tableDiscoveries) controller.abort()
    this.tableDiscoveries.clear()
    this.tableCaptures.clear()
  }
  private htmlInput(projectId: string, input: HtmlTableInput): HtmlTableInput {
    this.workspace.get(projectId)
    if (!!input.url === !!input.sourceId)
      throw new Error('Choose exactly one public URL or immutable saved HTML source.')
    if (input.url) return { url: tableSourceUrl(input.url) }
    this.htmlSource(projectId, input.sourceId!)
    return { sourceId: input.sourceId }
  }
  private htmlSource(projectId: string, sourceId: string) {
    const source = this.workspace.get(projectId).workspace.sources.find((s) => s.id === sourceId)
    if (!source?.snapshotPath || !source.sha256 || !/\.html?$/i.test(source.name))
      throw new Error('Choose a saved .html or .htm snapshot belonging to this project.')
    const inside = relative(
      join(this.userData, 'projects', projectId, 'workspace', 'sources'),
      source.snapshotPath,
    )
    if (
      !inside ||
      isAbsolute(inside) ||
      inside === '..' ||
      inside.startsWith('..\\') ||
      inside.startsWith('../')
    )
      throw new Error('HTML snapshot is outside this project source folder.')
    return source
  }
  private pruneTableCaptures(): void {
    for (const [id, capture] of this.tableCaptures)
      if (Date.now() - capture.created > 15 * 60_000) this.tableCaptures.delete(id)
  }
  private async acquireHtmlInput(
    projectId: string,
    input: HtmlTableInput,
    signal: AbortSignal,
  ): Promise<DurableInput> {
    const scope = this.htmlInput(projectId, input)
    signal.throwIfAborted()
    if (scope.sourceId) {
      const source = this.htmlSource(projectId, scope.sourceId),
        bytes = await this.workspace.boundedRead(source.snapshotPath!)
      signal.throwIfAborted()
      if (hash(bytes) !== source.sha256)
        throw new Error('Immutable HTML snapshot integrity failed.')
      if (this.htmlSource(projectId, source.id).sha256 !== source.sha256)
        throw new Error(
          'HTML source changed during discovery. Discover the current snapshot again.',
        )
      return {
        ordinal: 0,
        sourceId: source.id,
        sourceVersion: source.sha256!,
        name: source.name,
        uri: source.uri,
        retrievedAt: new Date().toISOString(),
        path: source.snapshotPath!,
        parsed: null,
        error: null,
      }
    }
    const fetched = await fetchTableSource(scope.url!, signal)
    signal.throwIfAborted()
    return {
      ordinal: 0,
      sourceId: hash(`html-url:${scope.url}`),
      sourceVersion: hash(fetched.bytes),
      name: `Public table - ${new URL(scope.url!).hostname.slice(0, 200)}.html`,
      uri: fetched.uri,
      retrievedAt: fetched.retrievedAt,
      path: await this.snapshot(projectId, 'html-tables.html', fetched.bytes),
      parsed: null,
      error: null,
    }
  }
  async discoverTables(projectId: string, input: HtmlTableInput): Promise<HtmlTableDiscovery> {
    const scope = this.htmlInput(projectId, input)
    this.pruneTableCaptures()
    if (this.tableDiscoveries.size >= 10)
      throw new Error('Too many table discoveries are running. Wait for a current check to finish.')
    const controller = new AbortController()
    this.tableDiscoveries.add(controller)
    try {
      const durable = await this.acquireHtmlInput(projectId, scope, controller.signal),
        bytes = await this.workspace.boundedRead(durable.path)
      controller.signal.throwIfAborted()
      if (hash(bytes) !== durable.sourceVersion)
        throw new Error('HTML snapshot integrity failed during discovery.')
      const parsed = parseHtmlTables(bytes),
        captureId = randomUUID()
      durable.parsed = JSON.stringify(parsed)
      this.workspace.get(projectId)
      this.pruneTableCaptures()
      while (this.tableCaptures.size >= 10)
        this.tableCaptures.delete(this.tableCaptures.keys().next().value!)
      this.tableCaptures.set(captureId, {
        projectId,
        input: scope,
        durable,
        parsed,
        created: Date.now(),
        usedByFullRun: false,
      })
      return {
        captureId,
        uri: durable.uri,
        sourceVersion: durable.sourceVersion,
        retrievedAt: durable.retrievedAt,
        tables: parsed.tables.map((table) => ({
          id: table.id,
          name: table.name,
          rowCount: table.rowCount,
          columns: table.columns.map((column) => ({ id: column.id, name: column.text })),
          sample: table.rows.slice(0, 10).map((row) => row.cells.map((entry) => entry.text)),
          supported: table.supported,
          blockers: table.blockers,
          warnings: table.warnings,
          notes: table.notes,
          headerNeedsConfirmation: table.headerNeedsConfirmation,
        })),
        issues: parsed.issues,
      }
    } finally {
      this.tableDiscoveries.delete(controller)
    }
  }
  private parsedKey(version: string, name: string): string {
    return `${PROCESSING_VERSION}:${version}:${extname(name).toLowerCase()}`
  }
  private cacheParsed(version: string, name: string, parsed: ParsedSource): void {
    const key = this.parsedKey(version, name)
    if (this.parsedInputs.has(key)) return
    const serialized = JSON.stringify(parsed),
      size = Buffer.byteLength(serialized)
    if (size > READINESS_PARSE_CACHE_BYTES) return
    if (this.parsedInputBytes + size > READINESS_PARSE_CACHE_BYTES) {
      this.parsedInputs.clear()
      this.parsedInputBytes = 0
    }
    this.parsedInputs.set(key, serialized)
    this.parsedInputBytes += size
  }
  async readiness(projectId: string, workflowId: string): Promise<ResearchReadiness> {
    const workflow = this.store.workflow(workflowId, projectId)
    if (workflow.config.kind !== 'quotes')
      throw new Error('Input readiness checks saved local supplier quote snapshots only.')
    if (workflow.config.sourceIds.length > 20 || !workflow.config.fields.includes('quote_id'))
      throw new Error('Input readiness requires at most 20 saved snapshots and the Quote ID field.')
    if (this.checkingInputs)
      throw new Error('Another input readiness check is running. Try again when it finishes.')
    const sourceSignature = this.freshness(workflow).sourceSignature
    const sources = this.workspace.get(projectId).workspace.sources
    const inputs: ResearchInputReadiness[] = [],
      datasets = new Map<string, ResearchDataset>()
    const seen = new Map<string, ResearchInputReadiness>()
    this.checkingInputs = true
    try {
      for (const id of workflow.config.sourceIds) {
        const source = sources.find((s) => s.id === id)
        const input: ResearchInputReadiness = {
          sourceId: id,
          sourceName: source?.name ?? 'Unavailable source',
          sourceVersion: source?.sha256 ?? null,
          status: 'ready',
          quoteId: null,
          findingCount: 0,
          findings: [],
        }
        inputs.push(input)
        try {
          if (!source?.snapshotPath || !source.sha256)
            throw new Error(
              'Saved local snapshot is unavailable. Add or update the source in this project.',
            )
          const bytes = await this.workspace.boundedRead(source.snapshotPath)
          if (hash(bytes) !== source.sha256)
            throw new Error(
              'Snapshot integrity failure. Update the source snapshot before checking again.',
            )
          const duplicate = seen.get(source.sha256)
          if (duplicate) {
            input.duplicateOf = duplicate.sourceId
            input.quoteId = duplicate.quoteId
            input.status = duplicate.status
            continue
          }
          seen.set(source.sha256, input)
          const cached = this.parsedInputs.get(this.parsedKey(source.sha256, source.name))
          const parsed = cached
            ? (JSON.parse(cached) as ParsedSource)
            : await parseSource(bytes, source.name)
          const dataset = mergeDatasets([
            extractQuote(
              parsed,
              {
                sourceId: source.id,
                sourceVersion: source.sha256,
                sourceName: source.name,
                uri: source.uri,
                retrievedAt: source.addedAt,
              },
              workflow.config.fields,
            ),
          ])
          this.cacheParsed(source.sha256, source.name, parsed)
          datasets.set(source.id, dataset)
          input.quoteId = dataset.tables[0].rows[0].cells.quote_id.value as string | null
          for (const value of quoteFindings(dataset)) addFinding(input, value)
        } catch (error) {
          addFinding(input, finding('blocked', String(error)))
        }
      }
      duplicateKeyFindings(inputs, datasets)
      for (const input of inputs.filter((i) => i.duplicateOf)) {
        const original = inputs.find((i) => i.sourceId === input.duplicateOf)!
        input.status = original.status
        addFinding(
          input,
          finding(
            original.status === 'blocked' ? 'blocked' : 'review',
            `Identical snapshot bytes to ${original.sourceName}. Processing handles this content once; the original readiness findings apply.`,
          ),
        )
      }
      const current = this.store.workflow(workflowId, projectId)
      if (
        current.configVersion !== workflow.configVersion ||
        this.freshness(current).sourceSignature !== sourceSignature
      )
        throw new Error(
          'Inputs or configuration changed while checking readiness. Check the current saved inputs again.',
        )
      const unique = inputs.filter((i) => !i.duplicateOf)
      return {
        workflowId,
        configVersion: workflow.configVersion,
        processingVersion: PROCESSING_VERSION,
        sourceSignature,
        checkedAt: new Date().toISOString(),
        readyToRun: inputs.length > 0 && !inputs.some((i) => i.status === 'blocked'),
        counts: {
          selected: inputs.length,
          unique: unique.length,
          ready: unique.filter((i) => i.status === 'ready').length,
          review: unique.filter((i) => i.status === 'review').length,
          blocked: unique.filter((i) => i.status === 'blocked').length,
          duplicates: inputs.length - unique.length,
        },
        inputs,
      }
    } finally {
      this.checkingInputs = false
    }
  }
  private async folder(projectId: string): Promise<string> {
    this.workspace.get(projectId)
    const path = join(this.userData, 'projects', projectId, 'workspace', 'research')
    await mkdir(path, { recursive: true })
    return path
  }
  state(projectId: string, offset = 0, workflowId?: string) {
    this.workspace.get(projectId)
    if (workflowId) this.store.workflow(workflowId, projectId)
    return {
      workflows: this.store.workflows(projectId),
      latestRuns: this.store.latest(projectId),
      freshness: Object.fromEntries(
        this.store.workflows(projectId).map((w) => [w.id, this.freshness(w)]),
      ),
      ...this.store.history(projectId, offset, workflowId),
      executor:
        'Local desktop queue. Scheduled acquisition runs only while Infomonk is open. Missed times coalesce into one run on reopening; publication always requires review.',
    }
  }
  detail(projectId: string, runId: string, page: ResearchPageRequest = {}) {
    const r = this.store.run(runId, projectId)
    const config = this.store.config(runId)
    const facts = r.candidate?.tables.some((t) => t.id === 'jobs')
      ? jobChanges(this.store.accepted(r.workflowId), r.candidate)
      : undefined
    const summary = facts ? (({ rows: _rows, ...counts }) => counts)(facts) : undefined
    return {
      ...r,
      inputsChanged: this.inputsChanged(this.store.workflow(r.workflowId), runId, r.sample),
      events: r.events.slice(-100),
      candidate: datasetPage(r.candidate, page, facts),
      jobChanges: summary,
      htmlContextChanged:
        config.kind === 'htmlTables' && r.candidate
          ? htmlContextChanged(this.store.accepted(r.workflowId), r.candidate)
          : undefined,
      changes:
        config.kind === 'htmlTables' && r.candidate
          ? diffHtmlTables(this.store.accepted(r.workflowId), r.candidate)
          : r.changes,
    }
  }
  private inputVersions(runId: string): { sourceId: string; sourceVersion: string; uri: string }[] {
    return this.store.db
      .prepare(
        "SELECT json_extract(data,'$.sourceId') AS sourceId,json_extract(data,'$.sourceVersion') AS sourceVersion,json_extract(data,'$.uri') AS uri FROM inputs WHERE run_id=? ORDER BY ordinal",
      )
      .all(runId)
      .map((r) => ({
        sourceId: String(r.sourceId),
        sourceVersion: String(r.sourceVersion),
        uri: String(r.uri),
      }))
  }
  private inputsChanged(w: ResearchWorkflow, runId: string, sample = false): boolean {
    const known = this.inputVersions(runId)
    if (w.config.kind === 'htmlTables' && w.config.htmlTables?.sourceId) {
      const source = this.workspace
        .get(w.projectId)
        .workspace.sources.find((s) => s.id === w.config.htmlTables!.sourceId)
      return known.some((input) => input.sourceVersion !== source?.sha256)
    }
    if (w.config.kind === 'quotes') {
      if (!known.length) return false
      const sources = this.workspace.get(w.projectId).workspace.sources
      if (sample)
        return known.some(
          (input) => sources.find((s) => s.id === input.sourceId)?.sha256 !== input.sourceVersion,
        )
      const current = new Set(
        w.config.sourceIds.map((id) => sources.find((s) => s.id === id)?.sha256),
      )
      const prior = new Set(known.map((input) => input.sourceVersion))
      return (
        current.size !== prior.size ||
        [...current].some((version) => !version || !prior.has(version))
      )
    }
    if (w.config.kind === 'enrich' && w.config.parentWorkflowId) {
      const parent = this.store.workflow(w.config.parentWorkflowId, w.projectId)
      const input = known.find((input) => input.sourceId === parent.id)
      return !!input && input.uri !== `infomonk:revision:${parent.id}:${parent.acceptedRevision}`
    }
    return false
  }
  private freshness(w: ResearchWorkflow): ResearchFreshness {
    const published = this.store.db
      .prepare(
        "SELECT id,config_version,updated_at FROM runs WHERE workflow_id=? AND status='published' ORDER BY updated_at DESC,id DESC LIMIT 1",
      )
      .get(w.id)
    const accepted = this.store.db
      .prepare('SELECT created_at FROM revisions WHERE workflow_id=? AND revision=?')
      .get(w.id, w.acceptedRevision)
    const sources = this.workspace.get(w.projectId).workspace.sources
    return {
      sourceSignature: hash(
        JSON.stringify({
          sources: (w.config.kind === 'htmlTables' && w.config.htmlTables?.sourceId
            ? [w.config.htmlTables.sourceId]
            : w.config.sourceIds
          ).map((id) => sources.find((s) => s.id === id)?.sha256 ?? null),
          parentRevision:
            w.config.kind === 'enrich' && w.config.parentWorkflowId
              ? this.store.workflow(w.config.parentWorkflowId, w.projectId).acceptedRevision
              : null,
        }),
      ),
      acceptedAt: accepted ? String(accepted.created_at) : null,
      configurationChanged: !!published && Number(published.config_version) !== w.configVersion,
      inputsChanged: !!published && this.inputsChanged(w, String(published.id)),
    }
  }
  summaries(projects: WorkspaceProject[]): Record<string, ResearchProjectSummary> {
    return Object.fromEntries(
      projects.map((project) => {
        const workflows = this.store.workflows(project.id)
        const pending = this.store.db
          .prepare(
            "SELECT SUM(CASE WHEN r.status='review' THEN 1 ELSE 0 END) AS reviews,SUM(CASE WHEN r.status IN ('queued','acquiring','processing') THEN 1 ELSE 0 END) AS active FROM runs r JOIN workflows w ON w.id=r.workflow_id WHERE w.project_id=?",
          )
          .get(project.id)
        const facts = this.store.db
          .prepare(
            "SELECT COUNT(DISTINCT a.workflow_id||':'||a.table_id||':'||a.row_id) AS rows,COUNT(DISTINCT a.workflow_id||':'||a.table_id) AS tables,SUM(CASE WHEN json_extract(a.cell,'$.value') IS NULL OR json_array_length(json_extract(a.cell,'$.issues'))>0 THEN 1 ELSE 0 END) AS unresolved FROM accepted_cells a JOIN workflows w ON w.id=a.workflow_id WHERE w.project_id=?",
          )
          .get(project.id)
        const freshness = workflows.map((w) => this.freshness(w))
        const changedWorkflow =
          workflows[freshness.findIndex((f) => f.inputsChanged || f.configurationChanged)]
        const review = this.store.db
          .prepare(
            "SELECT r.id,r.workflow_id FROM runs r JOIN workflows w ON w.id=r.workflow_id WHERE w.project_id=? AND r.status='review' ORDER BY r.updated_at DESC,r.id DESC LIMIT 1",
          )
          .get(project.id)
        const missing =
          !review && Number(facts?.unresolved ?? 0) > 0
            ? this.store.db
                .prepare(
                  "SELECT a.workflow_id FROM accepted_cells a JOIN workflows w ON w.id=a.workflow_id WHERE w.project_id=? AND (json_extract(a.cell,'$.value') IS NULL OR json_array_length(json_extract(a.cell,'$.issues'))>0) LIMIT 1",
                )
                .get(project.id)
            : null
        return [
          project.id,
          {
            reviewWorkflowId: review
              ? String(review.workflow_id)
              : missing
                ? String(missing.workflow_id)
                : (changedWorkflow?.id ?? null),
            reviewRunId: review ? String(review.id) : null,
            workflowCount: workflows.length,
            pendingReviews: Number(pending?.reviews ?? 0),
            activeRuns: Number(pending?.active ?? 0),
            unresolvedCells: Number(facts?.unresolved ?? 0),
            acceptedRows: Number(facts?.rows ?? 0),
            acceptedTables: Number(facts?.tables ?? 0),
            inputsChanged: freshness.some((f) => f.inputsChanged || f.configurationChanged),
            lastAcceptedAt:
              freshness
                .flatMap((f) => (f.acceptedAt ? [f.acceptedAt] : []))
                .sort()
                .at(-1) ?? null,
          },
        ]
      }),
    )
  }
  overview(projectId: string): ResearchOverview {
    this.workspace.get(projectId)
    const outputs = this.store.db
      .prepare(
        'SELECT r.workflow_id,w.name,r.revision,r.destination,r.created_at,w.accepted_revision FROM revisions r JOIN workflows w ON w.id=r.workflow_id WHERE w.project_id=? ORDER BY r.created_at DESC,r.revision DESC LIMIT 100',
      )
      .all(projectId)
      .map((r) => ({
        workflowId: String(r.workflow_id),
        name: String(r.name),
        revision: Number(r.revision),
        path: String(r.destination),
        at: String(r.created_at),
        current: Number(r.revision) === Number(r.accepted_revision),
      }))
    const events = this.store.db
      .prepare(
        'SELECT e.id,e.at,e.message,e.run_id,w.id AS workflow_id,w.name FROM run_events e JOIN runs r ON r.id=e.run_id JOIN workflows w ON w.id=r.workflow_id WHERE w.project_id=? ORDER BY e.id DESC LIMIT 50',
      )
      .all(projectId)
      .map((e) => ({
        id: `event:${e.id}`,
        at: String(e.at),
        text: `${e.name}: ${e.message}`,
        workflowId: String(e.workflow_id),
        runId: String(e.run_id),
      }))
    const corrections = this.store.db
      .prepare(
        'SELECT c.id,c.at,c.column_id,c.reason,w.id AS workflow_id,w.name FROM corrections c JOIN workflows w ON w.id=c.workflow_id WHERE w.project_id=? ORDER BY c.at DESC,c.rowid DESC LIMIT 50',
      )
      .all(projectId)
      .map((c) => ({
        id: `correction:${c.id}`,
        at: String(c.at),
        text: `${c.name}: corrected ${c.column_id} · ${c.reason}`,
        workflowId: String(c.workflow_id),
      }))
    return {
      outputs,
      outputCount: Number(
        this.store.db
          .prepare(
            'SELECT COUNT(*) AS count FROM revisions r JOIN workflows w ON w.id=r.workflow_id WHERE w.project_id=?',
          )
          .get(projectId)?.count ?? 0,
      ),
      activity: [...events, ...corrections].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50),
    }
  }
  async exportAccepted(
    projectId: string,
    workflowId: string,
    revision: number,
    target: string,
  ): Promise<void> {
    this.workspace.get(projectId)
    const workflow = this.store.workflow(workflowId, projectId)
    if (!Number.isSafeInteger(revision) || revision < 1)
      throw new Error('Choose a published accepted revision.')
    const stored = this.store.db
      .prepare('SELECT dataset FROM revisions WHERE workflow_id=? AND revision=?')
      .get(workflow.id, revision)
    if (!stored) throw new Error('Accepted revision not found.')
    const path = await exportTarget(
      target,
      this.userData,
      workspaceExportProtectedPaths(this.workspace),
    )
    // Export ledger facts, not a projection that may have been edited in the native sheet.
    const dataset = JSON.parse(String(stored.dataset)) as ResearchDataset
    const bytes = await projectDataset(dataset, workflow.id, revision)
    await writeXlsxAtomically(path, bytes)
  }
  cell(
    projectId: string,
    workflowId: string,
    runId: string | null,
    tableId: string,
    rowId: string,
    columnId: string,
  ) {
    const w = this.store.workflow(workflowId, projectId)
    const prior =
      this.store
        .accepted(w.id)
        ?.tables.find((t) => t.id === tableId)
        ?.rows.find((r) => r.id === rowId)?.cells[columnId] ?? null
    const run = runId ? this.store.run(runId, projectId) : null
    if (run && run.workflowId !== w.id) throw new Error('Cell is outside this workflow.')
    const cell = run
      ? run.candidate?.tables.find((t) => t.id === tableId)?.rows.find((r) => r.id === rowId)
          ?.cells[columnId]
      : prior
    if (!cell) throw new Error('Cell not found.')
    return { cell, prior }
  }
  absent(projectId: string, runId: string, offset = 0) {
    const run = this.store.run(runId, projectId)
    if (!run.candidate) throw new Error('Run has no candidate.')
    const rows =
      this.store.accepted(run.workflowId)?.tables.flatMap((t) => {
        const current = new Set(
          run.candidate?.tables.find((n) => n.id === t.id)?.rows.map((r) => r.id) ?? [],
        )
        return t.rows.filter((r) => !current.has(r.id)).map((row) => ({ table: t.name, row }))
      }) ?? []
    return {
      total: rows.length,
      offset,
      rows: rows.slice(offset, offset + 100).map((item) => ({
        ...item,
        row: {
          ...item.row,
          cells: Object.fromEntries(
            Object.entries(item.row.cells).map(([k, c]) => [k, previewCell(c)]),
          ),
        },
      })),
    }
  }
  async createFrom(projectId: string, workflowId: string, name: string, description: string) {
    const w = this.store.workflow(workflowId, projectId)
    const project = await this.workspace.create({
      name,
      description,
      startKind: w.config.kind === 'quotes' ? 'extractFiles' : 'researchWeb',
    })
    this.store.save(project.id, w.name, {
      ...w.config,
      sourceIds: [],
      countries: [],
      parentWorkflowId: undefined,
      jobSiteIds: [],
      htmlTables: undefined,
    })
    return project.id
  }
  save(projectId: string, name: string, config: ResearchConfig, workflowId?: string) {
    const project = this.workspace.get(projectId)
    if (config.kind === 'htmlTables') {
      if (!config.htmlTables) throw new Error('Discover and select whole HTML tables first.')
      const input = this.htmlInput(projectId, config.htmlTables),
        selections = config.htmlTables.selections
      if (
        !selections.length ||
        selections.length > 20 ||
        new Set(selections.map((selection) => selection.tableId)).size !== selections.length ||
        selections.some(
          (selection) =>
            !/^html_[a-f0-9]{24}$/.test(selection.tableId) ||
            !selection.keyColumns.length ||
            selection.keyColumns.length > 50 ||
            new Set(selection.keyColumns).size !== selection.keyColumns.length ||
            selection.keyColumns.some((column) => !/^column_[1-9]\d*$/.test(column)),
        )
      )
        throw new Error('Choose distinct HTML tables and explicit stable key columns.')
      this.pruneTableCaptures()
      const capture = config.htmlTables.captureId
        ? this.tableCaptures.get(config.htmlTables.captureId)
        : undefined
      if (capture) {
        if (
          capture.projectId !== projectId ||
          JSON.stringify(capture.input) !== JSON.stringify(input)
        )
          throw new Error('Table preview belongs to another project or source.')
        if (
          input.sourceId &&
          this.htmlSource(projectId, input.sourceId).sha256 !== capture.durable.sourceVersion
        )
          throw new Error(
            'Saved HTML changed after discovery. Discover the current snapshot again.',
          )
        htmlTablesDataset(capture.parsed, selections, {
          sourceId: capture.durable.sourceId,
          sourceVersion: capture.durable.sourceVersion,
          sourceName: capture.durable.name,
          uri: capture.durable.uri,
          retrievedAt: capture.durable.retrievedAt,
        })
      }
      config = { ...config, htmlTables: { ...config.htmlTables, ...input } }
    }
    if (config.kind === 'jobs') {
      const sites = config.jobSiteIds ?? []
      if (sites.length > JOB_SITES.length || new Set(sites).size !== sites.length)
        throw new Error('Confirm distinct supported job sources.')
      sites.forEach(jobSite)
    }
    if (workflowId) {
      const prior = this.store.workflow(workflowId, projectId)
      if (prior.acceptedRevision && prior.config.kind !== config.kind)
        throw new Error(
          'Create a new workflow for a different task kind; accepted table identities cannot be repurposed.',
        )
      if (
        prior.acceptedRevision &&
        prior.config.kind === 'htmlTables' &&
        config.kind === 'htmlTables'
      ) {
        const previous = prior.config.htmlTables!,
          next = config.htmlTables!
        if (
          previous.url !== next.url ||
          previous.sourceId !== next.sourceId ||
          previous.selections.some((selection) => {
            const match = next.selections.find((item) => item.tableId === selection.tableId)
            return (
              match && JSON.stringify(match.keyColumns) !== JSON.stringify(selection.keyColumns)
            )
          })
        )
          throw new Error(
            'Keep the accepted HTML source and key columns. Create a new workflow for a different row identity.',
          )
      }
    }
    if (
      workflowId &&
      this.store
        .corrections(workflowId)
        .some((c) => c.table_id === 'quotes' && !config.fields.includes(String(c.column_id)))
    )
      throw new Error(
        'Keep fields with persistent corrections in the schema. Removing overridden fields requires explicit reconciliation.',
      )
    if (
      config.sourceIds.some(
        (id) => !project.workspace.sources.some((s) => s.id === id && s.snapshotPath),
      )
    )
      throw new Error('Choose immutable local source snapshots in this project.')
    if (config.kind === 'enrich') {
      if (!config.parentWorkflowId) throw new Error('Choose an accepted quote workflow.')
      const parent = this.store.workflow(config.parentWorkflowId, projectId)
      if (parent.config.kind !== 'quotes')
        throw new Error('Enrichment supports quote records with country_code only.')
    }
    return this.store.save(projectId, name, config, workflowId)
  }
  run(projectId: string, workflowId: string, sample: boolean) {
    const w = this.store.workflow(workflowId, projectId)
    if (w.config.kind === 'quotes' && !w.config.sourceIds.length)
      throw new Error('Choose quote inputs first.')
    if (w.config.kind === 'jobs' && !w.config.jobSiteIds?.length)
      throw new Error('Choose job sources first.')
    if (['worldbank', 'enrich'].includes(w.config.kind) && !w.config.countries.length)
      throw new Error('Confirm country codes first.')
    const run = this.queue(w, sample, !sample)
    this.tick()
    return run
  }
  private queue(w: ResearchWorkflow, sample: boolean, replaceReviewedSample = false) {
    if (w.config.kind === 'htmlTables') {
      const config = w.config.htmlTables
      if (!config) throw new Error('Choose confirmed HTML tables first.')
      const scope = this.htmlInput(w.projectId, config)
      this.pruneTableCaptures()
      const capture = config.captureId ? this.tableCaptures.get(config.captureId) : undefined
      if (
        capture &&
        (capture.projectId !== w.projectId ||
          JSON.stringify(capture.input) !== JSON.stringify(scope))
      )
        throw new Error('Table preview belongs to another project or source.')
      const reusable =
        capture &&
        !capture.usedByFullRun &&
        !w.acceptedRevision &&
        (!scope.sourceId ||
          this.htmlSource(w.projectId, scope.sourceId).sha256 === capture.durable.sourceVersion)
      let inputs: DurableInput[] = []
      if (reusable) inputs = [structuredClone(capture.durable)]
      else if (scope.sourceId) {
        const source = this.htmlSource(w.projectId, scope.sourceId)
        inputs = [
          {
            ordinal: 0,
            sourceId: source.id,
            sourceVersion: source.sha256!,
            name: source.name,
            uri: source.uri,
            retrievedAt: new Date().toISOString(),
            path: source.snapshotPath!,
            parsed: null,
            error: null,
          },
        ]
      }
      const run = this.store.queue(w.id, sample, inputs, replaceReviewedSample)
      if (reusable && !sample) capture.usedByFullRun = true
      return run
    }
    const sources = this.workspace.get(w.projectId).workspace.sources
    const selected =
      w.config.kind === 'quotes'
        ? w.config.sourceIds.map((id) => {
            const s = sources.find((source) => source.id === id)
            if (!s?.snapshotPath || !s.sha256)
              throw new Error('Choose saved source snapshots first.')
            return s
          })
        : []
    const inputs = (sample ? selected.slice(0, 1) : selected).map((s, ordinal) => ({
      ordinal,
      sourceId: s.id,
      sourceVersion: s.sha256!,
      name: s.name,
      uri: s.uri,
      retrievedAt: s.addedAt,
      path: s.snapshotPath!,
      parsed: this.parsedInputs.get(this.parsedKey(s.sha256!, s.name)) ?? null,
      error: null,
    }))
    return this.store.queue(w.id, sample, inputs, replaceReviewedSample)
  }
  cancel(projectId: string, runId: string): void {
    this.store.run(runId, projectId)
    this.store.cancel(runId)
    if (this.activeRun === runId) this.controller?.abort()
  }
  retry(projectId: string, runId: string) {
    this.store.run(runId, projectId)
    const run = this.store.retry(runId)
    this.tick()
    return run
  }
  private tick(): void {
    if (this.running) return
    for (const workflow of this.store.due()) {
      try {
        this.queue(workflow, false)
      } catch {
        /* A pending review/running task takes precedence; no overlapping rerun. */
      }
      this.store.schedule(workflow.id, workflow.scheduleMinutes, false)
    }
    const run = this.store.next()
    if (!run) return
    this.running = true
    this.activeRun = run.id
    this.controller = new AbortController()
    void this.execute(run.id, this.controller.signal)
      .catch((error) => this.store.fail(run.id, String(error)))
      .finally(() => {
        this.running = false
        this.activeRun = null
        this.controller = null
        this.tick()
      })
  }
  private async snapshot(projectId: string, name: string, bytes: Buffer): Promise<string> {
    const folder = join(await this.folder(projectId), 'snapshots', hash(bytes))
    await mkdir(folder, { recursive: true })
    const path = join(folder, name)
    try {
      await writeFile(path, bytes, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (hash(await readFile(path)) !== hash(bytes))
        throw new Error('Existing snapshot integrity failure.', { cause: error })
    }
    return path
  }
  private async execute(runId: string, signal: AbortSignal): Promise<void> {
    const run = this.store.run(runId)
    const w = this.store.workflow(run.workflowId)
    const config = this.store.config(runId)
    if (config.kind === 'jobs') {
      await this.executeJobs(runId, signal)
      return
    }
    if (config.kind === 'htmlTables') {
      await this.executeHtmlTables(runId, signal)
      return
    }
    if (
      (config.kind === 'quotes' && !config.sourceIds.length) ||
      (config.kind !== 'quotes' && !config.countries.length)
    )
      throw new Error(
        'Workflow input scope is empty. Configure inputs before running or scheduling.',
      )
    const datasets: ResearchDataset[] = []
    const failures: string[] = []
    const known = this.store.inputs(runId)
    const sources = this.workspace.get(w.projectId).workspace.sources
    const quoteSources = config.sourceIds
      .map((id) => {
        const pinned = known.find((input) => input.sourceId === id)
        if (pinned)
          return {
            id: pinned.sourceId,
            name: pinned.name,
            uri: pinned.uri,
            sha256: pinned.sourceVersion,
            snapshotPath: pinned.path,
            addedAt: pinned.retrievedAt,
          }
        const source = sources.find((s) => s.id === id)
        if (!source) throw new Error('Configured source no longer exists')
        return source
      })
      .filter((s, i, all) => all.findIndex((a) => a.sha256 === s.sha256) === i)
    let total = config.kind === 'quotes' ? quoteSources.length : 1
    let completed = 0
    this.store.progress(runId, 'acquiring', 'Acquiring durable inputs', {
      total,
      complete: 0,
      failed: 0,
    })
    if (config.kind === 'quotes') {
      const selected = run.sample ? quoteSources.slice(0, 1) : quoteSources
      for (let index = 0; index < selected.length; index++) {
        this.store.assertActive(runId)
        signal.throwIfAborted()
        const source = selected[index]
        this.store.progress(
          runId,
          'processing',
          `Parsing ${index + 1}/${selected.length}: ${source.name}`,
          { total, complete: completed, failed: failures.length },
        )
        let input =
          known.find((i) => i.sourceId === source.id) ?? known.find((i) => i.ordinal === index)
        try {
          const bytes = await this.workspace.boundedRead(source.snapshotPath!)
          if (hash(bytes) !== source.sha256)
            throw new Error('Immutable source snapshot integrity failure')
          input ??= {
            ordinal: index,
            sourceId: source.id,
            sourceVersion: source.sha256!,
            name: source.name,
            uri: source.uri,
            retrievedAt: source.addedAt,
            path: source.snapshotPath!,
            parsed: null,
            error: null,
          }
          const parsed = input.parsed
            ? (JSON.parse(input.parsed) as ParsedSource)
            : await parseSource(bytes, source.name)
          this.store.assertActive(runId)
          input.parsed = JSON.stringify(parsed)
          input.error = null
          this.store.input(runId, input, { acquired: index + 1 })
          datasets.push(
            extractQuote(
              parsed,
              {
                sourceId: source.id,
                sourceVersion: source.sha256!,
                sourceName: source.name,
                uri: source.uri,
                retrievedAt: source.addedAt,
              },
              config.fields,
            ),
          )
          completed++
        } catch (error) {
          this.store.assertActive(runId)
          failures.push(`${source.name}: ${String(error)}`)
          if (input)
            this.store.input(runId, { ...input, error: String(error) }, { acquired: index })
        }
      }
    } else {
      let pages = 1
      let expectedTotal = -1
      for (let page = 1; page <= pages; page++) {
        this.store.assertActive(runId)
        signal.throwIfAborted()
        this.store.progress(runId, 'acquiring', `World Bank page ${page}/${pages}`)
        let input = known.find((i) => i.ordinal === page - 1)
        const uri = worldBankUrl(config, page)
        const bytes = input ? await readFile(input.path) : await fetchPopulation(uri, signal)
        if (input && hash(bytes) !== input.sourceVersion)
          throw new Error('Durable HTTP snapshot integrity failure')
        if (!input) {
          const path = await this.snapshot(w.projectId, `worldbank-page-${page}.json`, bytes)
          this.store.assertActive(runId)
          input = {
            ordinal: page - 1,
            sourceId: hash(uri),
            sourceVersion: hash(bytes),
            name: `World Bank page ${page}`,
            uri,
            retrievedAt: new Date().toISOString(),
            path,
            parsed: null,
            error: null,
          }
          this.store.input(runId, input, { page })
        }
        this.store.progress(runId, 'processing', `Validating World Bank page ${page}`)
        const parsed = parsePopulation(
          bytes,
          {
            sourceId: input.sourceId,
            sourceVersion: input.sourceVersion,
            sourceName: input.name,
            uri,
            retrievedAt: input.retrievedAt,
          },
          config,
          page,
        )
        if (page > 1 && (parsed.pages !== pages || parsed.total !== expectedTotal))
          throw new Error(
            'Acquisition coverage changed during pagination; accepted data unchanged.',
          )
        expectedTotal = parsed.total
        pages = parsed.pages
        total = pages
        datasets.push(parsed.dataset)
        completed++
        this.store.progress(runId, 'processing', `Validated World Bank page ${page}/${pages}`, {
          total,
          complete: completed,
          failed: 0,
        })
        if (run.sample) break
      }
      if (
        !run.sample &&
        (datasets.reduce((n, d) => n + d.tables[0].rows.length, 0) !== expectedTotal ||
          new Set(datasets.flatMap((d) => d.tables[0].rows.map((r) => r.id))).size !==
            expectedTotal)
      )
        throw new Error('Extraction coverage failed: missing or duplicate paginated records.')
    }
    this.store.assertActive(runId)
    signal.throwIfAborted()
    let dataset = mergeDatasets(datasets)
    if (config.kind === 'enrich') {
      const parent = this.store.workflow(config.parentWorkflowId!, w.projectId)
      const savedParent = known.find((i) => i.ordinal === 100)
      const internal = savedParent?.parsed
        ? (JSON.parse(savedParent.parsed) as ResearchDataset)
        : this.store.accepted(parent.id)
      if (!internal) throw new Error('Match failed: parent quote workflow has no accepted records.')
      // The full internal snapshot is local. Requests use only the explicitly confirmed public country scope.
      const serialized = JSON.stringify(internal)
      const path = await this.snapshot(w.projectId, 'accepted-parent.json', Buffer.from(serialized))
      this.store.input(
        runId,
        savedParent ?? {
          ordinal: 100,
          sourceId: parent.id,
          sourceVersion: hash(serialized),
          name: 'Accepted internal quote records',
          uri: `infomonk:revision:${parent.id}:${parent.acceptedRevision}`,
          retrievedAt: new Date().toISOString(),
          path,
          parsed: serialized,
          error: null,
        },
        { pagesAcquired: total, parentRevision: parent.acceptedRevision },
      )
      dataset = this.enrich(internal, dataset, config)
    }
    dataset.issues.push(...failures)
    this.store.review(runId, dataset, { complete: completed, failed: failures.length, total })
  }
  private async executeHtmlTables(runId: string, signal: AbortSignal): Promise<void> {
    const run = this.store.run(runId),
      workflow = this.store.workflow(run.workflowId),
      config = this.store.config(runId).htmlTables
    if (!config?.selections.length) throw new Error('Choose confirmed whole HTML tables.')
    this.store.progress(runId, 'acquiring', 'Acquiring one complete static HTML snapshot', {
      total: 1,
      complete: 0,
      failed: 0,
    })
    this.store.assertActive(runId)
    signal.throwIfAborted()
    let input = this.store.inputs(runId).find((item) => item.ordinal === 0)
    try {
      input ??= await this.acquireHtmlInput(workflow.projectId, config, signal)
      this.store.assertActive(runId)
      signal.throwIfAborted()
      // Persist acquisition before parsing/conversion so a failed/cancelled retry keeps its exact input.
      this.store.input(runId, input, { acquired: 1 })
      const bytes = await this.workspace.boundedRead(input.path)
      this.store.assertActive(runId)
      signal.throwIfAborted()
      if (hash(bytes) !== input.sourceVersion)
        throw new Error('Durable HTML snapshot integrity failed. Acquire a new run.')
      const parsed = input.parsed
        ? (JSON.parse(input.parsed) as ParsedHtmlTables)
        : parseHtmlTables(bytes)
      if (parsed.sourceVersion !== input.sourceVersion || parsed.method !== 'html-tables-v1')
        throw new Error('Stored HTML parse does not match its immutable snapshot.')
      input.parsed = JSON.stringify(parsed)
      input.error = null
      this.store.input(runId, input, { acquired: 1 })
      this.store.progress(runId, 'processing', 'Converting every row of the selected tables', {
        total: 1,
        complete: 1,
        failed: 0,
      })
      const dataset = htmlTablesDataset(parsed, config.selections, {
        sourceId: input.sourceId,
        sourceVersion: input.sourceVersion,
        sourceName: input.name,
        uri: input.uri,
        retrievedAt: input.retrievedAt,
      })
      this.store.assertActive(runId)
      signal.throwIfAborted()
      if (run.sample) {
        for (const table of dataset.tables) table.rows = table.rows.slice(0, 20)
        dataset.issues.push('Sample shows at most 20 rows per selected table and cannot publish.')
      }
      this.store.review(runId, dataset, { total: 1, complete: 1, failed: 0 })
    } catch (error) {
      this.store.assertActive(runId)
      if (input) this.store.input(runId, { ...input, error: String(error) }, { acquired: 1 })
      this.store.progress(runId, 'processing', 'HTML snapshot or table validation failed', {
        total: 1,
        complete: 0,
        failed: 1,
      })
      throw error
    }
  }
  private async executeJobs(runId: string, signal: AbortSignal): Promise<void> {
    const run = this.store.run(runId),
      w = this.store.workflow(run.workflowId),
      config = this.store.config(runId)
    const sites = config.jobSiteIds ?? []
    if (!sites.length || sites.length > JOB_SITES.length || new Set(sites).size !== sites.length)
      throw new Error('Confirm distinct supported job sources.')
    sites.forEach(jobSite)
    const observations: JobObservation[] = [],
      known = this.store.inputs(runId)
    this.store.progress(runId, 'acquiring', 'Checking confirmed public career sites', {
      total: sites.length,
      complete: 0,
      failed: 0,
    })
    const acquire = async (site: (typeof sites)[number], ordinal: number, raw: string) => {
      const uri = jobUrl(site, raw)
      this.store.assertActive(runId)
      signal.throwIfAborted()
      let input = known.find((i) => i.ordinal === ordinal)
      if (input && input.uri !== uri)
        throw new Error('Durable job input route changed; run a fresh check.')
      if (!input) {
        const bytes = await fetchJobPage(site, uri, signal)
        this.store.assertActive(runId)
        signal.throwIfAborted()
        const path = await this.snapshot(w.projectId, `jobs-${site}-${ordinal}.html`, bytes)
        input = {
          ordinal,
          sourceId: hash(uri),
          sourceVersion: hash(bytes),
          name: `${jobSite(site).name} page ${(ordinal % 1000) + 1}`,
          uri,
          retrievedAt: new Date().toISOString(),
          path,
          parsed: null,
          error: null,
        }
        this.store.input(runId, input, { ordinal })
      }
      const bytes = await this.workspace.boundedRead(input.path)
      if (hash(bytes) !== input.sourceVersion) throw new Error('Job snapshot integrity failed.')
      const page = input.parsed
        ? (JSON.parse(input.parsed) as JobPage)
        : parseJobPage(site, bytes, uri)
      this.store.assertActive(runId)
      signal.throwIfAborted()
      input.parsed = JSON.stringify(page)
      this.store.input(runId, input, { ordinal })
      observations.push({
        site,
        page,
        source: {
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion,
          sourceName: input.name,
          uri,
          retrievedAt: input.retrievedAt,
        },
      })
      return page
    }
    for (let i = 0; i < (run.sample ? 1 : sites.length); i++) {
      const site = sites[i]
      this.store.progress(runId, 'acquiring', `Checking ${jobSite(site).name}`)
      const pending = [jobUrl(site, jobStartUrl(site))],
        seen = new Set<string>()
      while (pending.length) {
        const uri = pending.shift()!
        if (seen.has(uri)) continue
        if (seen.size >= 900)
          throw new Error(
            'Job source exceeds 900 public page acquisitions; coverage remains incomplete.',
          )
        const page = await acquire(site, i * 1000 + seen.size, uri)
        seen.add(uri)
        for (const link of page.links) {
          const next = jobUrl(site, link)
          if (!seen.has(next) && !pending.includes(next)) pending.push(next)
        }
      }
      this.store.progress(runId, 'processing', `Checked ${i + 1}/${sites.length} selected sites`, {
        total: sites.length,
        complete: i + 1,
        failed: 0,
      })
    }
    const dataset = jobDataset(
      observations,
      run.sample ? null : this.store.accepted(w.id),
      run.sample ? sites.slice(0, 1) : sites,
    )
    this.store.review(runId, dataset, {
      total: sites.length,
      complete: run.sample ? 1 : sites.length,
      failed: 0,
    })
  }
  private enrich(
    internal: ResearchDataset,
    external: ResearchDataset,
    config: ResearchConfig,
  ): ResearchDataset {
    const next = structuredClone(internal)
    const table = next.tables.find((t) => t.id === 'quotes')
    if (!table?.columns.some((c) => c.id === 'country_code'))
      throw new Error('Match failed: choose country_code in the parent schema.')
    table.columns.push(
      { id: 'population', name: 'External population', type: 'number' },
      { id: 'population_year', name: 'Population year', type: 'number' },
    )
    for (const row of table.rows) {
      const code = row.cells.country_code.value
      const matches = external.tables
        .flatMap((t) => t.rows)
        .filter((r) => r.cells.country_code.value === code && r.cells.year.value === config.toYear)
      if (typeof code !== 'string' || !config.countries.includes(code) || matches.length !== 1) {
        const reason = `Entity match review: ${String(code ?? 'missing code')} has ${matches.length} exact matches in confirmed ${config.toYear} scope`
        row.cells.population = cell(null, [], reason, [reason], 'external')
        row.cells.population_year = cell(null, [], reason, [reason], 'external')
      } else {
        row.cells.population = structuredClone(matches[0].cells.population)
        row.cells.population_year = structuredClone(matches[0].cells.year)
      }
    }
    next.tables.push(...external.tables)
    return next
  }
  private async projection(
    workflowId: string,
    dataset: ResearchDataset,
    revision: number,
  ): Promise<string> {
    const w = this.store.workflow(workflowId)
    const path = join(
      await this.folder(w.projectId),
      `Research-${
        w.name
          .replace(/[^a-zA-Z0-9 -]/g, '')
          .trim()
          .slice(0, 48) || 'Table'
      }-r${revision}-${randomUUID().slice(0, 8)}.xlsx`,
    )
    await writeXlsxAtomically(path, await projectDataset(dataset, workflowId, revision))
    return path
  }
  async publish(
    projectId: string,
    runId: string,
    acknowledge: boolean,
    allowRemovals: boolean,
  ): Promise<string> {
    const run = this.store.run(runId, projectId)
    const assertInputs = () => {
      if (this.inputsChanged(this.store.workflow(run.workflowId, projectId), runId))
        throw new Error(
          'Source inputs changed since this run. Cancel this candidate and run again with the current snapshots.',
        )
    }
    assertInputs()
    const config = this.store.config(runId)
    if (config.kind === 'enrich') {
      const parent = this.store.inputs(runId).find((i) => i.ordinal === 100)
      if (
        !parent ||
        hash(JSON.stringify(this.store.accepted(config.parentWorkflowId!))) !== parent.sourceVersion
      )
        throw new Error('Internal accepted source changed; rerun enrichment.')
    }
    const dataset = this.store.prepare(runId, acknowledge, allowRemovals)
    const path = await this.projection(run.workflowId, dataset, run.baseRevision + 1)
    if (config.kind === 'enrich') {
      const parent = this.store.inputs(runId).find((i) => i.ordinal === 100)
      if (
        !parent ||
        hash(JSON.stringify(this.store.accepted(config.parentWorkflowId!))) !== parent.sourceVersion
      )
        throw new Error('Internal accepted source changed during publication; rerun enrichment.')
    }
    assertInputs()
    this.store.publish(runId, dataset, path)
    this.workspace.projects.moveFileToProject(path, projectId)
    this.workspace.rememberWorkbook(projectId, path)
    return path
  }
  async correct(
    projectId: string,
    workflowId: string,
    tableId: string,
    rowId: string,
    columnId: string,
    value: ResearchValue,
    reason: string,
  ): Promise<void> {
    const w = this.store.workflow(workflowId, projectId)
    const dataset = this.store.accepted(w.id)
    const table = dataset?.tables.find((t) => t.id === tableId)
    const target = table?.rows.find((r) => r.id === rowId)?.cells[columnId]
    const column = table?.columns.find((c) => c.id === columnId)
    if (!dataset || !target || !column) throw new Error('Accepted cell not found.')
    if (w.config.kind === 'htmlTables') {
      const keyScopes = this.store.db
        .prepare("SELECT config FROM runs WHERE workflow_id=? AND status='published'")
        .all(w.id)
        .map((row) => JSON.parse(String(row.config)) as ResearchConfig)
        .concat(w.config)
      if (
        keyScopes.some((config) =>
          config.htmlTables?.selections.some(
            (selection) => selection.tableId === tableId && selection.keyColumns.includes(columnId),
          ),
        )
      )
        throw new Error(
          'HTML source key columns are read-only in their selected table. Update the source and review a new run.',
        )
    }
    if (isResearchIdentity(tableId, columnId))
      throw new Error(
        'Record identity cannot be changed by a cell correction. Update the source or confirmed scope, then review a new run; related records must keep their original keys.',
      )
    if (
      tableId === 'jobs' &&
      columnId === 'application_status' &&
      !APPLICATION_STATUSES.includes(value as (typeof APPLICATION_STATUSES)[number])
    )
      throw new Error('Choose a supported application status.')
    if (
      value !== null &&
      (column.type === 'number'
        ? typeof value !== 'number' || !Number.isFinite(value)
        : typeof value !== 'string')
    )
      throw new Error('Correction does not match column type.')
    if (
      typeof value === 'number' &&
      ['total', 'quantity', 'unit_price', 'population'].includes(columnId) &&
      value < 0
    )
      throw new Error('Correction must be a nonnegative amount, quantity or population.')
    if (
      value !== null &&
      ['currency', 'country_code'].includes(columnId) &&
      !/^[A-Z]{3}$/.test(String(value))
    )
      throw new Error('Correction must be a three-letter uppercase code.')
    if (
      column.type === 'date' &&
      value !== null &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
        !Number.isFinite(Date.parse(String(value))) ||
        new Date(String(value)).toISOString().slice(0, 10) !== value)
    )
      throw new Error('Correction must be a valid ISO date.')
    target.value = value
    target.origin = 'manual'
    target.issues = []
    target.missingReason = value === null ? reason : null
    const path = await this.projection(w.id, dataset, w.acceptedRevision + 1)
    this.store.correct(
      w.id,
      tableId,
      rowId,
      columnId,
      value,
      reason,
      dataset,
      path,
      w.acceptedRevision,
    )
    this.workspace.projects.moveFileToProject(path, projectId)
    this.workspace.rememberWorkbook(projectId, path)
  }
  jobListingUrl(
    projectId: string,
    workflowId: string,
    runId: string | null,
    rowId: string,
  ): string {
    const w = this.store.workflow(workflowId, projectId)
    if (w.config.kind !== 'jobs') throw new Error('Choose a jobs workflow.')
    const run = runId ? this.store.run(runId, projectId) : null
    if (run && run.workflowId !== w.id) throw new Error('Job is outside this workflow.')
    const dataset = run ? run.candidate : this.store.accepted(w.id)
    const row = dataset?.tables.find((t) => t.id === 'jobs')?.rows.find((r) => r.id === rowId)
    if (
      !row ||
      typeof row.cells.listing_url.value !== 'string' ||
      typeof row.cells.job_key.value !== 'string'
    )
      throw new Error('Job listing not found.')
    const site = row.cells.job_key.value.split(':')[0] as NonNullable<
      ResearchConfig['jobSiteIds']
    >[number]
    return jobUrl(site, row.cells.listing_url.value)
  }
  async evidence(
    projectId: string,
    evidence: Evidence,
  ): Promise<{ text: string; locator: string; sourceName: string }> {
    const input = this.findEvidence(projectId, evidence)
    const bytes = await readFile(input.path)
    if (hash(bytes) !== input.sourceVersion)
      throw new Error('Snapshot integrity failed; evidence cannot be verified.')
    const isJobSnapshot =
      input.parsed && /^bermuda-jobs-/.test((JSON.parse(input.parsed) as JobPage).method ?? '')
    if (input.parsed && (!evidence.locator.startsWith('JSON ') || isJobSnapshot)) {
      const parsed = JSON.parse(input.parsed) as ParsedSource
      const unit = parsed.units.find(
        (u) => u.locator === evidence.locator && u.text === evidence.excerpt,
      )
      if (!unit) {
        const field = parsed.units
          .flatMap((u) => Object.values(u.fields ?? {}))
          .find((f) => f.locator === evidence.locator && f.text === evidence.excerpt)
        if (field) return { text: field.text, locator: field.locator, sourceName: input.name }
        throw new Error('Evidence locator no longer resolves.')
      }
      return { text: unit.text, locator: unit.locator, sourceName: input.name }
    }
    const match = evidence.locator.match(/^JSON \/1\/(\d+)\/(.+)$/)
    if (!match) throw new Error('Unsupported evidence locator')
    const record = JSON.parse(bytes.toString('utf8'))[1]?.[Number(match[1])]
    if (!record || JSON.stringify(record) !== evidence.excerpt)
      throw new Error('Evidence locator does not match its immutable snapshot.')
    return {
      text: JSON.stringify(record, null, 2),
      locator: evidence.locator,
      sourceName: input.name,
    }
  }
  private findEvidence(projectId: string, evidence: Evidence): DurableInput {
    this.workspace.get(projectId)
    // Resolve trusted ledger inputs instead of accepting renderer file paths.
    const row = this.store.db
      .prepare(
        "SELECT i.data FROM inputs i JOIN runs r ON i.run_id=r.id JOIN workflows w ON r.workflow_id=w.id WHERE w.project_id=? AND json_extract(i.data,'$.sourceId')=? AND json_extract(i.data,'$.sourceVersion')=? LIMIT 1",
      )
      .get(projectId, evidence.sourceId, evidence.sourceVersion)
    if (row) return JSON.parse(String(row.data)) as DurableInput
    throw new Error('Evidence input not found in this project.')
  }
  async evidencePath(projectId: string, evidence: Evidence): Promise<string> {
    await this.evidence(projectId, evidence)
    const input = this.findEvidence(projectId, evidence)
    if (!['.pdf', '.docx', '.md', '.txt'].includes(extname(input.path).toLowerCase()))
      throw new Error('Use the JSON evidence inspector for this structured web snapshot.')
    const folder = join(await this.folder(projectId), 'previews', randomUUID())
    await mkdir(folder, { recursive: true })
    const path = join(folder, input.name)
    await copyFile(input.path, path)
    this.workspace.projects.moveFileToProject(path, projectId)
    return path
  }
  async sheetCell(path: string, selection: EvidenceSelection): Promise<CellDetails | null> {
    const bytes = await this.workspace.boundedRead(path)
    await assertZipInflatesWithinLimits(bytes, XLSX_ZIP_LIMITS)
    const zip = await JSZip.loadAsync(bytes)
    const part = zip.file('infomonk/research.json')
    if (!part) return null
    const json = await part.async('string')
    if (json.length > RESEARCH_METADATA_LIMIT)
      throw new Error('Research metadata exceeds the supported bound.')
    const metadata = JSON.parse(json) as {
      workflowId: string
      revision: number
      tables: {
        id: string
        name: string
        headerMode?: string
        columns?: { id: string; name: string }[]
      }[]
    }
    const w = this.store.workflow(metadata.workflowId)
    if (
      !this.workspace
        .get(w.projectId)
        .files.some((file) => file.toLowerCase() === path.toLowerCase())
    )
      throw new Error('Workbook is outside this project.')
    const projectionTable = metadata.tables.find((t) => t.name === selection.tableId)
    const tableId = projectionTable?.id ?? selection.tableId
    const columnId =
      projectionTable?.headerMode === 'labels'
        ? projectionTable.columns?.find((c) => c.name === selection.columnId)?.id
        : selection.columnId
    if (!columnId) return null
    const dataset = this.store.accepted(w.id)
    const cell = dataset?.tables
      .find((t) => t.id === tableId)
      ?.rows.find((r) => r.id === selection.rowId)?.cells[columnId]
    if (!cell) return null
    return {
      workflowId: w.id,
      tableId,
      rowId: selection.rowId,
      columnId,
      columnName:
        projectionTable?.headerMode === 'labels'
          ? dataset?.tables.find((t) => t.id === tableId)?.columns.find((c) => c.id === columnId)
              ?.name
          : undefined,
      revision: w.acceptedRevision,
      cell,
      editedInSheet: metadata.revision !== w.acceptedRevision || selection.value !== cell.value,
      corrections: this.store.corrections(w.id, tableId, selection.rowId, columnId).map((c) => ({
        value: JSON.parse(String(c.value)),
        reason: String(c.reason),
        at: String(c.at),
      })),
    }
  }
}
