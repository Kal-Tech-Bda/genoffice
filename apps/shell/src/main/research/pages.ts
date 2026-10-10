import type { ResearchDataset, ResearchPageRequest, ResearchCell } from '../../shared/research-api'

export const RESEARCH_PAGE_ROWS = 100
export function rowNeedsReview(row: ResearchDataset['tables'][number]['rows'][number]): boolean {
  return Object.values(row.cells).some((cell) => cell.value === null || cell.issues.length > 0)
}
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
      .map((t) => {
        const rows = page.needsReview ? t.rows.filter(rowNeedsReview) : t.rows
        return {
          ...t,
          totalRows: rows.length,
          allRows: t.rows.length,
          offset,
          rows: rows.slice(offset, offset + RESEARCH_PAGE_ROWS).map((row) => ({
            ...row,
            cells: Object.fromEntries(
              Object.entries(row.cells).map(([key, value]) => [key, previewCell(value)]),
            ),
          })),
        }
      }),
  }
}
