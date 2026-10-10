import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type {
  ResearchConfig,
  ResearchDataset,
  ResearchRun,
  ResearchValue,
  ResearchWorkflow,
  ResearchRunSummary,
} from '../../shared/research-api'
import { PROCESSING_VERSION } from './extract'
import { checkedResearchMetadata } from './metadata'

type SqlRow = Record<string, string | number | null>
export interface DurableInput {
  ordinal: number
  sourceId: string
  sourceVersion: string
  name: string
  uri: string
  retrievedAt: string
  path: string
  parsed: string | null
  error: string | null
}
const now = () => new Date().toISOString()
const decode = <T>(text: unknown): T => JSON.parse(String(text)) as T
const summaryColumns =
  'id,workflow_id,config_version,processing_version,base_revision,sample,status,progress,error,created_at,updated_at,coverage,(candidate IS NOT NULL) AS has_candidate'
function runSummary(r: SqlRow): ResearchRunSummary {
  return {
    id: String(r.id),
    workflowId: String(r.workflow_id),
    configVersion: Number(r.config_version),
    processingVersion: String(r.processing_version),
    baseRevision: Number(r.base_revision),
    sample: !!r.sample,
    status: String(r.status) as ResearchRunSummary['status'],
    progress: String(r.progress),
    error: r.error === null ? null : String(r.error),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    coverage: decode<ResearchRunSummary['coverage']>(r.coverage),
    hasCandidate: !!r.has_candidate,
  }
}
export function diffDataset(
  prior: ResearchDataset | null,
  next: ResearchDataset,
): ResearchRun['changes'] {
  const old = new Map(
    prior?.tables.flatMap((t) =>
      t.rows.map((r) => [
        `${t.id}:${r.id}`,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(r.cells).map(([k, c]) => [
              k,
              [
                c.value,
                c.missingReason,
                [...new Set(c.evidence.map((e) => e.sourceVersion))].sort(),
              ],
            ]),
          ),
        ),
      ]),
    ) ?? [],
  )
  let added = 0
  let changed = 0
  for (const t of next.tables)
    for (const r of t.rows) {
      const key = `${t.id}:${r.id}`
      const value = JSON.stringify(
        Object.fromEntries(
          Object.entries(r.cells).map(([k, c]) => [
            k,
            [c.value, c.missingReason, [...new Set(c.evidence.map((e) => e.sourceVersion))].sort()],
          ]),
        ),
      )
      if (!old.has(key)) added++
      else if (old.get(key) !== value) changed++
      old.delete(key)
    }
  return { added, changed, removed: old.size }
}
/** Authoritative local dataset ledger and single queue. Project JSON remains shell/chat metadata. */
export class ResearchStore {
  readonly db: DatabaseSync
  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    const version = Number((this.db.prepare('PRAGMA user_version').get() as SqlRow).user_version)
    if (version > 2) throw new Error('Research database is newer than this application.')
    if (version === 0)
      this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE workflows(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, config TEXT NOT NULL, config_version INTEGER NOT NULL, schedule_minutes INTEGER, next_at TEXT, paused INTEGER NOT NULL DEFAULT 0, accepted_revision INTEGER NOT NULL DEFAULT 0, destination TEXT);
      CREATE TABLE runs(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id), config_version INTEGER NOT NULL, config TEXT NOT NULL, processing_version TEXT NOT NULL, base_revision INTEGER NOT NULL, sample INTEGER NOT NULL, status TEXT NOT NULL, progress TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, coverage TEXT NOT NULL, candidate TEXT, acquisition_cursor TEXT NOT NULL DEFAULT '{}', execution_checkpoint TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE inputs(run_id TEXT NOT NULL REFERENCES runs(id), ordinal INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(run_id,ordinal));
      CREATE TABLE revisions(workflow_id TEXT NOT NULL REFERENCES workflows(id), revision INTEGER NOT NULL, dataset TEXT NOT NULL, destination TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(workflow_id,revision));
      CREATE TABLE accepted_cells(workflow_id TEXT NOT NULL, table_id TEXT NOT NULL, row_id TEXT NOT NULL, column_id TEXT NOT NULL, revision INTEGER NOT NULL, cell TEXT NOT NULL, PRIMARY KEY(workflow_id,table_id,row_id,column_id));
      CREATE TABLE corrections(id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id), table_id TEXT NOT NULL, row_id TEXT NOT NULL, column_id TEXT NOT NULL, value TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);
      CREATE INDEX run_queue ON runs(status,created_at); CREATE INDEX correction_cell ON corrections(workflow_id,table_id,row_id,column_id);
      PRAGMA user_version=1; COMMIT;`)
    if (version < 2)
      this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE run_events(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),at TEXT NOT NULL,status TEXT NOT NULL,message TEXT NOT NULL);
      INSERT INTO run_events(run_id,at,status,message) SELECT id,updated_at,status,progress FROM runs;
      PRAGMA user_version=2; COMMIT;`)
    this.db.exec('CREATE INDEX IF NOT EXISTS run_history ON runs(workflow_id,created_at DESC)')
    for (const run of this.db
      .prepare("SELECT id FROM runs WHERE status IN ('acquiring','processing')")
      .all())
      this.event(
        String(run.id),
        'failed',
        'Application interrupted execution; durable inputs retained',
      )
    this.db
      .prepare(
        "UPDATE runs SET status='failed',error='Interrupted by application shutdown. Retry resumes durable inputs.',progress='Interrupted; accepted data unchanged',updated_at=? WHERE status IN ('acquiring','processing')",
      )
      .run(now())
  }
  close(): void {
    this.db.close()
  }
  private event(id: string, status: string, message: string): void {
    this.db
      .prepare('INSERT INTO run_events(run_id,at,status,message) VALUES(?,?,?,?)')
      .run(id, now(), status, message.slice(0, 4000))
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  workflow(id: string, projectId?: string): ResearchWorkflow {
    const r = this.db.prepare('SELECT * FROM workflows WHERE id=?').get(id) as SqlRow | undefined
    if (!r || (projectId && r.project_id !== projectId))
      throw new Error('Workflow not found in this project.')
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name),
      config: decode(r.config),
      configVersion: Number(r.config_version),
      scheduleMinutes: r.schedule_minutes === null ? null : Number(r.schedule_minutes),
      nextAt: r.next_at === null ? null : String(r.next_at),
      paused: !!r.paused,
      acceptedRevision: Number(r.accepted_revision),
      destination: r.destination === null ? null : String(r.destination),
    }
  }
  workflows(projectId: string): ResearchWorkflow[] {
    return (
      this.db
        .prepare('SELECT id FROM workflows WHERE project_id=? ORDER BY rowid DESC')
        .all(projectId) as SqlRow[]
    ).map((r) => this.workflow(String(r.id)))
  }
  save(projectId: string, name: string, config: ResearchConfig, id?: string): ResearchWorkflow {
    if (id) {
      this.workflow(id, projectId)
      for (const run of this.db
        .prepare(
          "SELECT id FROM runs WHERE workflow_id=? AND status IN ('queued','acquiring','processing','review')",
        )
        .all(id))
        this.event(
          String(run.id),
          'obsolete',
          'Configuration changed; this candidate cannot publish',
        )
      this.db
        .prepare('UPDATE workflows SET name=?,config=?,config_version=config_version+1 WHERE id=?')
        .run(name, JSON.stringify(config), id)
      this.db
        .prepare(
          "UPDATE runs SET status='obsolete',progress='Workflow changed; create a new run',updated_at=? WHERE workflow_id=? AND status IN ('queued','acquiring','processing','review')",
        )
        .run(now(), id)
    } else {
      id = randomUUID()
      this.db
        .prepare(
          'INSERT INTO workflows(id,project_id,name,config,config_version) VALUES(?,?,?,?,1)',
        )
        .run(id, projectId, name, JSON.stringify(config))
    }
    return this.workflow(id)
  }
  schedule(id: string, minutes: number | null, paused: boolean): void {
    this.db
      .prepare('UPDATE workflows SET schedule_minutes=?,paused=?,next_at=? WHERE id=?')
      .run(
        minutes,
        Number(paused),
        minutes && !paused ? new Date(Date.now() + minutes * 60_000).toISOString() : null,
        id,
      )
  }
  due(): ResearchWorkflow[] {
    return (
      this.db
        .prepare(
          'SELECT id FROM workflows WHERE schedule_minutes IS NOT NULL AND paused=0 AND next_at<=?',
        )
        .all(now()) as SqlRow[]
    ).map((r) => this.workflow(String(r.id)))
  }
  queue(id: string, sample: boolean, inputs: DurableInput[] = []): ResearchRun {
    return this.transaction(() => {
      const w = this.workflow(id)
      const pending = this.db
        .prepare(
          "SELECT id FROM runs WHERE workflow_id=? AND status IN ('queued','acquiring','processing','review')",
        )
        .get(id)
      if (pending) throw new Error('Review, cancel or finish the current run before another run.')
      const runId = randomUUID()
      const at = now()
      this.db
        .prepare(
          "INSERT INTO runs(id,workflow_id,config_version,config,processing_version,base_revision,sample,status,progress,created_at,updated_at,coverage) VALUES(?,?,?,?,?,?,?,'queued','Queued',?,?,?)",
        )
        .run(
          runId,
          id,
          w.configVersion,
          JSON.stringify(w.config),
          PROCESSING_VERSION,
          w.acceptedRevision,
          Number(sample),
          at,
          at,
          JSON.stringify({ complete: 0, failed: 0, total: 0 }),
        )
      this.event(runId, 'queued', 'Attempt queued')
      const insert = this.db.prepare('INSERT INTO inputs(run_id,ordinal,data) VALUES(?,?,?)')
      for (const input of inputs) insert.run(runId, input.ordinal, JSON.stringify(input))
      return this.run(runId)
    })
  }
  run(id: string, projectId?: string): ResearchRun {
    const r = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as SqlRow | undefined
    if (!r) throw new Error('Run not found.')
    const w = this.workflow(String(r.workflow_id), projectId)
    const candidate = r.candidate === null ? null : decode<ResearchDataset>(r.candidate)
    return {
      id,
      workflowId: w.id,
      configVersion: Number(r.config_version),
      processingVersion: String(r.processing_version),
      baseRevision: Number(r.base_revision),
      sample: !!r.sample,
      status: String(r.status) as ResearchRun['status'],
      progress: String(r.progress),
      error: r.error === null ? null : String(r.error),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      events: this.db
        .prepare('SELECT at,status,message FROM run_events WHERE run_id=? ORDER BY id')
        .all(id)
        .map((e) => ({ at: String(e.at), status: String(e.status), message: String(e.message) })),
      coverage: decode(r.coverage),
      candidate: candidate ? this.overlay(w.id, candidate) : null,
      changes: candidate
        ? diffDataset(this.accepted(w.id), this.overlay(w.id, candidate))
        : { added: 0, changed: 0, removed: 0 },
    }
  }
  config(runId: string): ResearchConfig {
    return decode(
      (this.db.prepare('SELECT config FROM runs WHERE id=?').get(runId) as SqlRow).config,
    )
  }
  runs(projectId: string): ResearchRun[] {
    return (
      this.db
        .prepare(
          'SELECT r.id FROM runs r JOIN workflows w ON r.workflow_id=w.id WHERE w.project_id=? ORDER BY r.created_at DESC LIMIT 100',
        )
        .all(projectId) as SqlRow[]
    ).map((r) => this.run(String(r.id)))
  }
  history(
    projectId: string,
    offset = 0,
    workflowId?: string,
  ): { runs: ResearchRunSummary[]; history: { offset: number; total: number; limit: number } } {
    const where = 'w.project_id=?' + (workflowId ? ' AND w.id=?' : '')
    const params = workflowId ? [projectId, workflowId] : [projectId]
    const total = Number(
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM runs r JOIN workflows w ON r.workflow_id=w.id WHERE ${where}`,
          )
          .get(...params) as SqlRow
      ).count,
    )
    const columns = summaryColumns
      .split(',')
      .map((c) =>
        c === '(candidate IS NOT NULL) AS has_candidate'
          ? '(r.candidate IS NOT NULL) AS has_candidate'
          : 'r.' + c,
      )
      .join(',')
    const rows = this.db
      .prepare(
        `SELECT ${columns} FROM runs r JOIN workflows w ON r.workflow_id=w.id WHERE ${where} ORDER BY r.created_at DESC,r.id DESC LIMIT 20 OFFSET ?`,
      )
      .all(...params, offset) as SqlRow[]
    const runs = rows.map(runSummary)
    return { runs, history: { offset, total, limit: 20 } }
  }
  summary(id: string, projectId: string): ResearchRunSummary {
    const r = this.db.prepare(`SELECT ${summaryColumns} FROM runs WHERE id=?`).get(id) as
      SqlRow | undefined
    if (!r) throw new Error('Run not found.')
    this.workflow(String(r.workflow_id), projectId)
    return runSummary(r)
  }
  latest(projectId: string): ResearchRunSummary[] {
    const statement = this.db.prepare(
      `SELECT ${summaryColumns} FROM runs WHERE workflow_id=? ORDER BY created_at DESC,id DESC LIMIT 1`,
    )
    return this.workflows(projectId).flatMap((w) => {
      const row = statement.get(w.id) as SqlRow | undefined
      return row ? [runSummary(row)] : []
    })
  }
  next(): ResearchRun | null {
    const r = this.db
      .prepare("SELECT id FROM runs WHERE status='queued' ORDER BY created_at LIMIT 1")
      .get() as SqlRow | undefined
    return r ? this.run(String(r.id)) : null
  }
  assertActive(id: string): void {
    const r = this.run(id)
    const w = this.workflow(r.workflowId)
    if (!['queued', 'acquiring', 'processing', 'review'].includes(r.status))
      throw new Error(`Run is ${r.status}`)
    if (w.configVersion !== r.configVersion || r.processingVersion !== PROCESSING_VERSION)
      throw new Error('Obsolete processing/configuration version')
  }
  progress(
    id: string,
    status: ResearchRun['status'],
    progress: string,
    coverage?: ResearchRun['coverage'],
  ): void {
    this.assertActive(id)
    this.event(id, status, progress)
    this.db
      .prepare(
        'UPDATE runs SET status=?,progress=?,updated_at=?,coverage=COALESCE(?,coverage) WHERE id=?',
      )
      .run(status, progress, now(), coverage ? JSON.stringify(coverage) : null, id)
  }
  input(id: string, input: DurableInput, cursor: object): void {
    this.assertActive(id)
    this.transaction(() => {
      this.db
        .prepare('INSERT OR REPLACE INTO inputs(run_id,ordinal,data) VALUES(?,?,?)')
        .run(id, input.ordinal, JSON.stringify(input))
      this.db
        .prepare('UPDATE runs SET acquisition_cursor=?,updated_at=? WHERE id=?')
        .run(JSON.stringify(cursor), now(), id)
    })
  }
  inputs(id: string): DurableInput[] {
    return (
      this.db.prepare('SELECT data FROM inputs WHERE run_id=? ORDER BY ordinal').all(id) as SqlRow[]
    ).map((r) => decode(r.data))
  }
  review(id: string, dataset: ResearchDataset, coverage: ResearchRun['coverage']): void {
    this.assertActive(id)
    this.event(
      id,
      'review',
      `Validation completed: ${coverage.complete}/${coverage.total} inputs, ${coverage.failed} failures`,
    )
    this.db
      .prepare(
        "UPDATE runs SET status='review',progress='Candidate ready for review; accepted data unchanged',candidate=?,coverage=?,execution_checkpoint=?,updated_at=? WHERE id=?",
      )
      .run(
        JSON.stringify(dataset),
        JSON.stringify(coverage),
        JSON.stringify({ processingVersion: PROCESSING_VERSION, complete: true }),
        now(),
        id,
      )
  }
  fail(id: string, error: string, coverage?: ResearchRun['coverage']): void {
    const r = this.run(id)
    if (['cancelled', 'obsolete'].includes(r.status)) return
    coverage ??= { ...r.coverage, failed: Math.max(1, r.coverage.total - r.coverage.complete) }
    this.event(id, 'failed', error)
    this.db
      .prepare(
        "UPDATE runs SET status='failed',error=?,progress='Failed; accepted data unchanged',coverage=COALESCE(?,coverage),updated_at=? WHERE id=?",
      )
      .run(error.slice(0, 4000), coverage ? JSON.stringify(coverage) : null, now(), id)
  }
  cancel(id: string): void {
    const r = this.run(id)
    if (r.status === 'published') throw new Error('Published runs cannot be cancelled.')
    this.event(id, 'cancelled', 'User cancelled execution/review')
    this.db
      .prepare(
        "UPDATE runs SET status='cancelled',progress='Cancelled; accepted data unchanged',updated_at=? WHERE id=?",
      )
      .run(now(), id)
  }
  retry(id: string): ResearchRun {
    const r = this.run(id)
    if (!['failed', 'cancelled'].includes(r.status))
      throw new Error('Only failed or cancelled runs can retry.')
    const w = this.workflow(r.workflowId)
    if (
      r.configVersion !== w.configVersion ||
      r.baseRevision !== w.acceptedRevision ||
      r.processingVersion !== PROCESSING_VERSION
    )
      throw new Error('Run is obsolete; create a new run.')
    if (
      this.db
        .prepare(
          "SELECT id FROM runs WHERE workflow_id=? AND id<>? AND status IN ('queued','acquiring','processing','review')",
        )
        .get(w.id, id)
    )
      throw new Error('Another run is pending.')
    this.event(id, 'queued', 'Retry attempt queued; durable acquired inputs retained')
    this.db
      .prepare(
        "UPDATE runs SET status='queued',error=NULL,progress='Retry queued with durable inputs',updated_at=? WHERE id=?",
      )
      .run(now(), id)
    return this.run(id)
  }
  accepted(id: string): ResearchDataset | null {
    const w = this.workflow(id)
    if (!w.acceptedRevision) return null
    return decode(
      (
        this.db
          .prepare('SELECT dataset FROM revisions WHERE workflow_id=? AND revision=?')
          .get(id, w.acceptedRevision) as SqlRow
      ).dataset,
    )
  }
  corrections(id: string, tableId?: string, rowId?: string, columnId?: string): SqlRow[] {
    const rows = this.db
      .prepare('SELECT * FROM corrections WHERE workflow_id=? ORDER BY rowid')
      .all(id) as SqlRow[]
    return rows.filter(
      (r) =>
        (!tableId || r.table_id === tableId) &&
        (!rowId || r.row_id === rowId) &&
        (!columnId || r.column_id === columnId),
    )
  }
  overlay(id: string, candidate: ResearchDataset): ResearchDataset {
    const next = structuredClone(candidate)
    for (const correction of this.corrections(id)) {
      const table = next.tables.find((t) => t.id === correction.table_id)
      const row = table?.rows.find((r) => r.id === correction.row_id)
      const target = row?.cells[String(correction.column_id)]
      if (target) {
        target.value = decode(correction.value)
        target.origin = 'manual'
        target.missingReason = target.value === null ? String(correction.reason) : null
        target.issues = []
      }
    }
    return next
  }
  prepare(id: string, acknowledge: boolean, allowRemovals: boolean): ResearchDataset {
    this.assertActive(id)
    const r = this.run(id)
    const w = this.workflow(r.workflowId)
    if (r.status !== 'review' || !r.candidate || r.sample)
      throw new Error('Only a completed full candidate can publish. Samples cannot publish.')
    if (
      r.coverage.total < 1 ||
      r.coverage.failed ||
      r.coverage.complete !== r.coverage.total ||
      r.baseRevision !== w.acceptedRevision
    )
      throw new Error('Incomplete coverage or changed accepted revision; rerun before publication.')
    let next = this.overlay(w.id, r.candidate)
    if (
      (next.issues.length ||
        next.tables.some((t) =>
          t.rows.some((row) =>
            Object.values(row.cells).some((c) => c.missingReason || c.issues.length),
          ),
        )) &&
      !acknowledge
    )
      throw new Error('Acknowledge missing facts and validation issues before publication.')
    const prior = this.accepted(w.id)
    if (prior)
      for (const oldTable of prior.tables) {
        let table = next.tables.find((t) => t.id === oldTable.id)
        const retained = oldTable.rows.filter(
          (old) =>
            !table?.rows.some((row) => row.id === old.id) &&
            (!allowRemovals || this.corrections(w.id, oldTable.id, old.id).length > 0),
        )
        if (retained.length) {
          if (!table) {
            table = { ...oldTable, rows: [] }
            next.tables.push(table)
          }
          table.rows.push(...retained)
          next.issues.push(
            `${retained.length} absent ${oldTable.name} records retained by deletion/override policy`,
          )
        }
      }
    next = this.overlay(w.id, next)
    return next
  }
  private writeAccepted(
    id: string,
    revision: number,
    dataset: ResearchDataset,
    destination: string,
  ): void {
    this.db
      .prepare('INSERT INTO revisions VALUES(?,?,?,?,?)')
      .run(id, revision, JSON.stringify(dataset), destination, now())
    this.db.prepare('DELETE FROM accepted_cells WHERE workflow_id=?').run(id)
    const insert = this.db.prepare('INSERT INTO accepted_cells VALUES(?,?,?,?,?,?)')
    for (const t of dataset.tables)
      for (const r of t.rows)
        for (const [column, cell] of Object.entries(r.cells))
          insert.run(id, t.id, r.id, column, revision, JSON.stringify(cell))
    this.db
      .prepare('UPDATE workflows SET accepted_revision=?,destination=? WHERE id=?')
      .run(revision, destination, id)
  }
  publish(id: string, dataset: ResearchDataset, destination: string): number {
    return this.transaction(() => {
      this.assertActive(id)
      const r = this.run(id)
      const w = this.workflow(r.workflowId)
      if (
        r.status !== 'review' ||
        r.sample ||
        w.acceptedRevision !== r.baseRevision ||
        r.coverage.failed ||
        r.coverage.total < 1 ||
        r.coverage.complete !== r.coverage.total
      )
        throw new Error('Publication lost its version fence.')
      const revision = w.acceptedRevision + 1
      checkedResearchMetadata(dataset, w.id, revision)
      this.writeAccepted(w.id, revision, dataset, destination)
      this.event(id, 'published', `Accepted revision ${revision}`)
      this.db
        .prepare(
          "UPDATE runs SET status='published',progress='Accepted revision published',updated_at=? WHERE id=?",
        )
        .run(now(), id)
      return revision
    })
  }
  correct(
    id: string,
    table: string,
    row: string,
    column: string,
    value: ResearchValue,
    reason: string,
    dataset: ResearchDataset,
    destination: string,
    baseRevision: number,
  ): void {
    this.transaction(() => {
      const w = this.workflow(id)
      if (w.acceptedRevision !== baseRevision)
        throw new Error('Accepted revision changed during correction.')
      checkedResearchMetadata(dataset, id, baseRevision + 1)
      this.db
        .prepare('INSERT INTO corrections VALUES(?,?,?,?,?,?,?,?)')
        .run(randomUUID(), id, table, row, column, JSON.stringify(value), reason, now())
      this.writeAccepted(id, baseRevision + 1, dataset, destination)
    })
  }
}
