export type ResearchValue = string | number | null
import type { JobSiteId } from './jobs-api'
export function isResearchIdentity(tableId: string, columnId: string): boolean {
  return (
    (tableId === 'jobs' && !['application_status', 'notes'].includes(columnId)) ||
    tableId === 'job_sources' ||
    (['quotes', 'line_items'].includes(tableId) && columnId === 'quote_id') ||
    (tableId === 'population' && ['country_code', 'year'].includes(columnId))
  )
}
export interface Evidence {
  sourceId: string
  sourceVersion: string
  sourceName: string
  uri: string
  retrievedAt: string
  locator: string
  excerpt: string
  method: string
}
export interface ResearchCell {
  value: ResearchValue
  missingReason: string | null
  evidence: Evidence[]
  issues: string[]
  origin: 'internal' | 'external' | 'manual'
  evidenceCount?: number
}
export interface ResearchRow {
  id: string
  cells: Record<string, ResearchCell>
}
export interface ResearchTable {
  id: string
  name: string
  rowMeaning: string
  columns: { id: string; name: string; type: 'text' | 'number' | 'date' }[]
  rows: ResearchRow[]
  totalRows?: number
  offset?: number
  allRows?: number
}
export interface ResearchDataset {
  schemaVersion: 1
  tables: ResearchTable[]
  issues: string[]
}
export interface ResearchConfig {
  kind: 'quotes' | 'worldbank' | 'enrich' | 'jobs'
  instructions: string
  sourceIds: string[]
  fields: string[]
  countries: string[]
  fromYear: number
  toYear: number
  parentWorkflowId?: string
  jobSiteIds?: JobSiteId[]
}
export interface ResearchWorkflow {
  id: string
  projectId: string
  name: string
  config: ResearchConfig
  configVersion: number
  scheduleMinutes: number | null
  nextAt: string | null
  paused: boolean
  acceptedRevision: number
  destination: string | null
}
export interface ResearchRun {
  inputsChanged?: boolean
  id: string
  workflowId: string
  configVersion: number
  processingVersion: string
  baseRevision: number
  sample: boolean
  status:
    | 'queued'
    | 'acquiring'
    | 'processing'
    | 'review'
    | 'failed'
    | 'cancelled'
    | 'obsolete'
    | 'published'
  progress: string
  error: string | null
  createdAt: string
  updatedAt: string
  events: { at: string; status: string; message: string }[]
  coverage: { complete: number; failed: number; total: number }
  candidate: ResearchDataset | null
  changes: { added: number; changed: number; removed: number }
}
export interface ResearchState {
  workflows: ResearchWorkflow[]
  runs: ResearchRunSummary[]
  latestRuns: ResearchRunSummary[]
  executor: string
  history: { offset: number; total: number; limit: number }
  freshness: Record<string, ResearchFreshness>
}
export interface ResearchFreshness {
  sourceSignature: string
  acceptedAt: string | null
  configurationChanged: boolean
  inputsChanged: boolean
}
export interface ReadinessFinding {
  severity: 'review' | 'blocked'
  message: string
  field?: string
  excerpts: { sourceName: string; locator: string; text: string; truncated: boolean }[]
}
export interface ResearchInputReadiness {
  sourceId: string
  sourceName: string
  sourceVersion: string | null
  status: 'ready' | 'review' | 'blocked'
  quoteId: string | null
  duplicateOf?: string
  findingCount: number
  findings: ReadinessFinding[]
}
export interface ResearchReadiness {
  workflowId: string
  configVersion: number
  processingVersion: string
  sourceSignature: string
  checkedAt: string
  readyToRun: boolean
  counts: {
    selected: number
    unique: number
    ready: number
    review: number
    blocked: number
    duplicates: number
  }
  inputs: ResearchInputReadiness[]
}
export interface ResearchProjectSummary {
  reviewWorkflowId: string | null
  reviewRunId: string | null
  workflowCount: number
  pendingReviews: number
  activeRuns: number
  unresolvedCells: number
  acceptedRows: number
  acceptedTables: number
  inputsChanged: boolean
  lastAcceptedAt: string | null
}
export interface ResearchOverview {
  outputCount: number
  outputs: {
    workflowId: string
    name: string
    revision: number
    path: string
    at: string
    current: boolean
  }[]
  activity: { id: string; at: string; text: string; workflowId: string; runId?: string }[]
}
export type ResearchRunSummary = Omit<ResearchRun, 'candidate' | 'events' | 'changes'> & {
  hasCandidate: boolean
}
export interface ResearchPageRequest {
  tableId?: string
  offset?: number
  needsReview?: boolean
}
export interface ResearchAbsentPage {
  rows: { table: string; row: ResearchRow }[]
  offset: number
  total: number
}
export interface CellDetails {
  workflowId: string
  tableId: string
  rowId: string
  columnId: string
  revision: number
  cell: ResearchCell
  corrections: { value: ResearchValue; reason: string; at: string }[]
  editedInSheet: boolean
}
export interface ResearchApi {
  readiness(projectId: string, workflowId: string): Promise<ResearchReadiness>
  overview(projectId: string): Promise<ResearchOverview>
  policy(projectId: string): Promise<{
    version: number
    firstInputPattern: string
    privateCloudRequests: boolean
    generatedCodeExecution: boolean
    budgets: {
      maxCostUsd: number
      maxAgentTurns: number
      sampleTimeoutSeconds: number
      runnerCpuSeconds: number
      runnerMemoryMiB: number
      runnerOutputMiB: number
    }
    publication: string
    evaluationCorpus: string
  }>
  state(projectId: string, offset?: number, workflowId?: string): Promise<ResearchState>
  detail(projectId: string, runId: string, page?: ResearchPageRequest): Promise<ResearchRun>
  cell(
    projectId: string,
    workflowId: string,
    runId: string | null,
    tableId: string,
    rowId: string,
    columnId: string,
  ): Promise<{ cell: ResearchCell; prior: ResearchCell | null }>
  absent(projectId: string, runId: string, offset?: number): Promise<ResearchAbsentPage>
  save(
    projectId: string,
    name: string,
    config: ResearchConfig,
    workflowId?: string,
  ): Promise<ResearchWorkflow>
  run(projectId: string, workflowId: string, sample: boolean): Promise<ResearchRunSummary>
  cancel(projectId: string, runId: string): Promise<void>
  retry(projectId: string, runId: string): Promise<ResearchRunSummary>
  publish(
    projectId: string,
    runId: string,
    acknowledgeIssues: boolean,
    allowRemovals: boolean,
  ): Promise<string>
  schedule(
    projectId: string,
    workflowId: string,
    minutes: number | null,
    paused: boolean,
  ): Promise<void>
  copy(projectId: string, workflowId: string): Promise<ResearchWorkflow>
  createFrom(
    projectId: string,
    workflowId: string,
    name: string,
    description: string,
  ): Promise<string>
  accepted(
    projectId: string,
    workflowId: string,
    page?: ResearchPageRequest,
  ): Promise<ResearchDataset | null>
  correct(
    projectId: string,
    workflowId: string,
    tableId: string,
    rowId: string,
    columnId: string,
    value: ResearchValue,
    reason: string,
  ): Promise<void>
  open(projectId: string, workflowId: string): Promise<void>
  visitJob(
    projectId: string,
    workflowId: string,
    runId: string | null,
    rowId: string,
  ): Promise<void>
  evidence(
    projectId: string,
    evidence: Evidence,
  ): Promise<{ text: string; locator: string; sourceName: string }>
  openEvidence(projectId: string, evidence: Evidence): Promise<void>
}
export interface EvidenceSelection {
  tableId: string
  rowId: string
  columnId: string
  value: ResearchValue
}
export interface SheetEvidenceApi {
  cell(selection: EvidenceSelection): Promise<CellDetails | null>
  inspect(
    details: CellDetails,
    evidenceIndex: number,
  ): Promise<{ text: string; locator: string; sourceName: string }>
  open(details: CellDetails, evidenceIndex: number): Promise<void>
}
export const RESEARCH_CHANNEL = 'infomonk:research'
export const EVIDENCE_CHANNEL = 'infomonk:evidence'
