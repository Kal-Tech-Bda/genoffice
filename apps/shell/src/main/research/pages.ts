import type { ResearchDataset, ResearchPageRequest, ResearchCell } from '../../shared/research-api'

export const RESEARCH_PAGE_ROWS = 100
export function previewCell(cell: ResearchCell): ResearchCell {
  return { ...cell, evidence: [], evidenceCount: cell.evidence.length }
}
export function datasetPage(
  dataset: ResearchDataset | null,
  page: ResearchPageRequest = {},
): ResearchDataset | null {
  if (!dataset) return null
  const offset = page.offset ?? 0
  return {
    schemaVersion: dataset.schemaVersion,
    issues: dataset.issues,
    tables: dataset.tables
      .filter((t) => !page.tableId || t.id === page.tableId)
      .map((t) => ({
        ...t,
        totalRows: t.rows.length,
        offset,
        rows: t.rows.slice(offset, offset + RESEARCH_PAGE_ROWS).map((row) => ({
          ...row,
          cells: Object.fromEntries(
            Object.entries(row.cells).map(([key, value]) => [key, previewCell(value)]),
          ),
        })),
      })),
  }
}
