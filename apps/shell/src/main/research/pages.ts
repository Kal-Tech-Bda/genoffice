import type { ResearchDataset, ResearchPageRequest, ResearchCell } from '../../shared/research-api'
import type { JobChanges } from './job-changes'

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
  changes?: JobChanges,
): ResearchDataset | null {
  if (!dataset) return null
  const offset = page.offset ?? 0
  return {
    schemaVersion: dataset.schemaVersion,
    issues: dataset.issues,
    tables: dataset.tables
      .filter((t) => !page.tableId || t.id === page.tableId)
      .map((t) => {
        const view = page.view?.tableId === t.id ? page.view : undefined
        let rows = page.needsReview ? t.rows.filter(rowNeedsReview) : t.rows
        if (view) {
          if (view.changesOnly && !changes)
            throw new Error('Refresh changes require a jobs candidate, not an accepted table.')
          const terms = (view.query ?? '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
          rows = rows.filter((row) => {
            const text = Object.values(row.cells)
              .map((c) => String(c.value ?? ''))
              .join(' ')
              .toLocaleLowerCase()
            if (!terms.every((term) => text.includes(term))) return false
            if (t.id !== 'jobs') return true
            if (
              view.roleGroups?.length &&
              !view.roleGroups.includes(String(row.cells.role_group?.value))
            )
              return false
            if (
              view.sourceSites?.length &&
              !view.sourceSites.includes(String(row.cells.source_site?.value))
            )
              return false
            if (
              view.applicationStatus &&
              row.cells.application_status?.value !== view.applicationStatus
            )
              return false
            const status = String(row.cells.listing_status?.value ?? '')
            if (
              view.availability === 'not-found' &&
              !status.startsWith('Not found in latest check')
            )
              return false
            if (view.availability === 'talent-pool' && !status.startsWith('Talent pool'))
              return false
            if (
              view.availability === 'past-deadline' &&
              row.cells.deadline_status?.value !== 'Past deadline'
            )
              return false
            if (view.availability === 'listed' && !status.startsWith('Listed')) return false
            if (
              view.availability === 'review' &&
              !(
                row.cells.location?.issues.length ||
                row.cells.closing_date?.value === null ||
                /review|unconfirmed|talent pool|not found|unavailable/i.test(status)
              )
            )
              return false
            if (
              view.changesOnly &&
              (!changes || changes.rows[row.id]?.classification === 'unchanged')
            )
              return false
            return true
          })
          if (view.sort) {
            const { columnId, direction } = view.sort
            if (!t.columns.some((c) => c.id === columnId))
              throw new Error('Unknown sort column in this table.')
            rows = [...rows].sort((a, b) => {
              const av = a.cells[columnId]?.value ?? null,
                bv = b.cells[columnId]?.value ?? null
              if (av === null || bv === null)
                return av === bv ? a.id.localeCompare(b.id) : av === null ? 1 : -1
              const order =
                typeof av === 'number' && typeof bv === 'number'
                  ? av - bv
                  : String(av).localeCompare(String(bv), 'en', {
                      numeric: true,
                      sensitivity: 'base',
                    })
              return (direction === 'desc' ? -order : order) || a.id.localeCompare(b.id)
            })
          }
        }
        const facets =
          t.id === 'jobs'
            ? Object.fromEntries(
                ['role_group', 'source_site'].map((key) => {
                  const counts = new Map<string, number>()
                  for (const row of t.rows) {
                    const value = row.cells[key]?.value
                    if (typeof value === 'string' && value)
                      counts.set(value, (counts.get(value) ?? 0) + 1)
                  }
                  return [
                    key,
                    [...counts]
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([value, count]) => ({ value, count })),
                  ]
                }),
              )
            : undefined
        return {
          ...t,
          totalRows: rows.length,
          allRows: t.rows.length,
          offset,
          facets,
          rows: rows.slice(offset, offset + RESEARCH_PAGE_ROWS).map((row) => ({
            ...row,
            change:
              t.id === 'jobs' && changes?.rows[row.id]
                ? {
                    kind: changes.rows[row.id].classification,
                    fields: changes.rows[row.id].changedFields,
                  }
                : undefined,
            cells: Object.fromEntries(
              Object.entries(row.cells).map(([key, value]) => [key, previewCell(value)]),
            ),
          })),
        }
      }),
  }
}
