import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
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
} from '../../shared/research-api'
import { ResearchStore, type DurableInput } from './store'
import { cell, extractQuote, hash, mergeDatasets, parseSource, type ParsedSource } from './extract'
import { fetchPopulation, parsePopulation, worldBankUrl } from './worldbank'
import { projectDataset } from './projection'
import { datasetPage, previewCell } from './pages'
import { RESEARCH_METADATA_LIMIT } from './metadata'

export class ResearchService {
  readonly store: ResearchStore
  private running = false
  private controller: AbortController | null = null
  private activeRun: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
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
      ...this.store.history(projectId, offset, workflowId),
      executor:
        'Local desktop queue. Scheduled acquisition runs only while Infomonk is open. Missed times coalesce into one run on reopening; publication always requires review.',
    }
  }
  detail(projectId: string, runId: string, page: ResearchPageRequest = {}) {
    const r = this.store.run(runId, projectId)
    return { ...r, events: r.events.slice(-100), candidate: datasetPage(r.candidate, page) }
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
    const project = await this.workspace.create({ name, description })
    this.store.save(project.id, w.name, {
      ...w.config,
      sourceIds: [],
      countries: [],
      parentWorkflowId: undefined,
    })
    return project.id
  }
  save(projectId: string, name: string, config: ResearchConfig, workflowId?: string) {
    const project = this.workspace.get(projectId)
    if (workflowId) {
      const prior = this.store.workflow(workflowId, projectId)
      if (prior.acceptedRevision && prior.config.kind !== config.kind)
        throw new Error(
          'Create a new workflow for a different task kind; accepted table identities cannot be repurposed.',
        )
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
    if (w.config.kind !== 'quotes' && !w.config.countries.length)
      throw new Error('Confirm country codes first.')
    const run = this.store.queue(workflowId, sample)
    this.tick()
    return run
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
        this.store.queue(workflow.id, false)
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
        let input = known.find((i) => i.ordinal === index)
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
    this.store.publish(runId, dataset, path)
    this.workspace.projects.moveFileToProject(path, projectId)
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
    if (
      value !== null &&
      (column.type === 'number'
        ? typeof value !== 'number' || !Number.isFinite(value)
        : typeof value !== 'string')
    )
      throw new Error('Correction does not match column type.')
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
  }
  async evidence(
    projectId: string,
    evidence: Evidence,
  ): Promise<{ text: string; locator: string; sourceName: string }> {
    const input = this.findEvidence(projectId, evidence)
    const bytes = await readFile(input.path)
    if (hash(bytes) !== input.sourceVersion)
      throw new Error('Snapshot integrity failed; evidence cannot be verified.')
    if (input.parsed && !evidence.locator.startsWith('JSON ')) {
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
      tables: { id: string; name: string }[]
    }
    const w = this.store.workflow(metadata.workflowId)
    if (
      !this.workspace
        .get(w.projectId)
        .files.some((file) => file.toLowerCase() === path.toLowerCase())
    )
      throw new Error('Workbook is outside this project.')
    const tableId =
      metadata.tables.find((t) => t.name === selection.tableId)?.id ?? selection.tableId
    const dataset = this.store.accepted(w.id)
    const cell = dataset?.tables
      .find((t) => t.id === tableId)
      ?.rows.find((r) => r.id === selection.rowId)?.cells[selection.columnId]
    if (!cell) return null
    return {
      workflowId: w.id,
      tableId,
      rowId: selection.rowId,
      columnId: selection.columnId,
      revision: w.acceptedRevision,
      cell,
      editedInSheet: metadata.revision !== w.acceptedRevision || selection.value !== cell.value,
      corrections: this.store
        .corrections(w.id, tableId, selection.rowId, selection.columnId)
        .map((c) => ({
          value: JSON.parse(String(c.value)),
          reason: String(c.reason),
          at: String(c.at),
        })),
    }
  }
}
