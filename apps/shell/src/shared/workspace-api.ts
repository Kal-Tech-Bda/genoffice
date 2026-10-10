import type { ProjectData } from '@genoffice/project-store'
import type { CellScalar } from '@genoffice/xlsx-gateway/domain/workbook.types'

export type WorkspaceProject = ProjectData
export interface CreateWorkspace {
  name: string
  description: string
  filePath?: string
  url?: string
  delimiter?: string
}
export interface TableProfile {
  sha256: string
  sheets: { id: string; name: string; range: string; rows: number; columns: number }[]
  sheetId: string
  range: string
  headers: string[]
  sample: CellScalar[][]
  rowCount: number
  formulaCount: number
  columns: { name: string; blanks: number; numbers: number; total: number }[]
  structuralBlocker: string | null
  recordReferences: { id: string; row: number; version: string; sheet: string }[]
}
export interface CleanupOptions {
  sheetId: string
  range: string
  hasHeader: boolean
  trim: boolean
  removeBlankRows: boolean
  keys: number[]
  deduplicate: boolean
  sortColumn: number | null
  descending: boolean
  renames: Record<string, string>
  formats: Record<string, 'number' | 'date-iso' | 'date-us' | 'date-uk'>
}
export interface CleanupPreview {
  token: string
  before: CellScalar[][]
  after: CellScalar[][]
  inputRows: number
  outputRows: number
  changedCells: number
  duplicates: number
  blankRows: number
  warnings: string[]
}
export interface WorkspaceApi {
  onSourceDrop(listener: (paths: string[]) => void): () => void
  list(): Promise<WorkspaceProject[]>
  create(input: CreateWorkspace): Promise<WorkspaceProject>
  update(
    id: string,
    patch: { name?: string; description?: string; starred?: boolean },
  ): Promise<WorkspaceProject>
  open(id: string): Promise<void>
  pickFile(): Promise<string | null>
  filePreview(
    path: string,
    delimiter?: string,
  ): Promise<{ delimiter: string | null; rows: string[][] }>
  addSource(id: string, input: { path?: string; url?: string }): Promise<WorkspaceProject>
  openSource(id: string, sourceId: string): Promise<void>
  layout(left: number, top: number): Promise<void>
  profile(id: string, sheetId?: string, range?: string, hasHeader?: boolean): Promise<TableProfile>
  preview(id: string, options: CleanupOptions): Promise<CleanupPreview>
  discard(token: string): Promise<void>
  apply(id: string, token: string): Promise<WorkspaceProject>
  undoCleanup(id: string): Promise<WorkspaceProject>
  exportWorkbook(id: string, ownedPath?: string): Promise<boolean>
}
export const WORKSPACE_CHANNEL = 'infomonk:workspace'
