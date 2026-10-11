import type {
  Evidence,
  ReadinessFinding,
  ResearchDataset,
  ResearchInputReadiness,
} from '../../shared/research-api'
import { mergeDatasets } from './extract'

export const READINESS_FINDING_LIMIT = 12
export const READINESS_PARSE_CACHE_BYTES = 16 * 1024 * 1024
export function finding(
  severity: ReadinessFinding['severity'],
  message: string,
  evidence: Evidence[] = [],
  field?: string,
): ReadinessFinding {
  return {
    severity,
    message: message.slice(0, 1000),
    ...(field ? { field } : {}),
    excerpts: evidence.slice(0, 3).map((e) => ({
      sourceName: e.sourceName,
      locator: e.locator,
      text: e.excerpt.slice(0, 500),
      truncated: e.excerpt.length > 500,
    })),
  }
}
export function quoteFindings(dataset: ResearchDataset): ReadinessFinding[] {
  const result: ReadinessFinding[] = []
  for (const table of dataset.tables)
    for (const row of table.rows)
      for (const [field, cell] of Object.entries(row.cells)) {
        if (table.id === 'line_items' && field === 'quote_id') continue
        if (table.id === 'quotes' && field === 'quote_id' && cell.value === null)
          result.push(
            finding(
              'blocked',
              'A single nonempty Quote ID is required. Update the source snapshot before running the full batch.',
              cell.evidence,
              field,
            ),
          )
        else if (cell.value === null || cell.issues.length)
          result.push(
            finding(
              'review',
              `${table.id === 'line_items' ? 'Line item ' : ''}${field}: ${cell.missingReason ?? cell.issues.join('; ')}`,
              cell.evidence,
              field,
            ),
          )
      }
  for (const issue of dataset.issues) result.push(finding('review', issue))
  return result
}
export function addFinding(input: ResearchInputReadiness, value: ReadinessFinding): void {
  input.findingCount++
  if (input.findings.length < READINESS_FINDING_LIMIT) input.findings.push(value)
  if (value.severity === 'blocked') input.status = 'blocked'
  else if (input.status === 'ready') input.status = 'review'
}
export function duplicateKeyFindings(
  inputs: ResearchInputReadiness[],
  datasets: Map<string, ResearchDataset>,
): void {
  const groups = new Map<string, ResearchInputReadiness[]>()
  for (const input of inputs) {
    if (!input.quoteId || input.duplicateOf || input.status === 'blocked') continue
    groups.set(input.quoteId, [...(groups.get(input.quoteId) ?? []), input])
  }
  for (const [key, group] of groups) {
    if (group.length < 2) continue
    const merged = mergeDatasets(group.map((input) => datasets.get(input.sourceId)!))
    const changed = merged.tables.flatMap((table) =>
      table.rows.flatMap((row) =>
        Object.entries(row.cells)
          .filter(
            ([, cell]) =>
              cell.missingReason === 'Duplicate business key has conflicting source values',
          )
          .map(([column, cell]) => ({
            field: table.id === 'quotes' ? column : `${table.name} ${column}`,
            evidence: cell.evidence,
          })),
      ),
    )
    for (const input of group)
      addFinding(
        input,
        finding(
          'review',
          changed.length
            ? `Quote ID ${key} appears in multiple snapshots with differing ${[...new Set(changed.map((c) => c.field))].join(', ')} values. Review the merged candidate and its source evidence.`
            : `Quote ID ${key} appears in multiple different snapshots. Processing merges the quote and numbered item keys; review their combined evidence.`,
          changed.length ? changed[0].evidence : merged.tables[0].rows[0].cells.quote_id.evidence,
        ),
      )
  }
}
