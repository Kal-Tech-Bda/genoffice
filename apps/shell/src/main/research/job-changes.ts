import type { ResearchDataset, ResearchRow, ResearchValue } from '../../shared/research-api'

const factFields = [
  'title',
  'employer',
  'location',
  'closing_date',
  'posted_date',
  'advertiser',
  'advert_expiry',
] as const

export type JobFactField = (typeof factFields)[number] | 'listing_status'
export type JobAvailability =
  'listed' | 'not-found' | 'outside-selected-sources' | 'talent-pool' | 'unavailable' | 'other'
export type JobChangeClassification =
  'added' | 'changed' | 'unchanged' | 'not-found' | 'returned' | 'outside-selected-sources'
export interface JobFactChange {
  field: JobFactField
  previous: ResearchValue
  current: ResearchValue
}
export interface JobRowChange {
  classification: JobChangeClassification
  availability: JobAvailability
  changedFields: JobFactField[]
  changes: JobFactChange[]
  trackingPreserved: boolean
}
export interface JobChanges {
  added: number
  changed: number
  unchanged: number
  notFound: number
  returned: number
  trackingPreserved: number
  outsideSources: number
  rows: Record<string, JobRowChange>
}

const value = (row: ResearchRow, field: string): ResearchValue => row.cells[field]?.value ?? null

function availability(row: ResearchRow): { kind: JobAvailability; key: string } {
  const status = String(value(row, 'listing_status') ?? '')
    .trim()
    .toLowerCase()
  if (status.startsWith('outside selected sources'))
    return { kind: 'outside-selected-sources', key: 'outside-selected-sources' }
  if (status.startsWith('not found in latest check')) return { kind: 'not-found', key: 'not-found' }
  if (status.startsWith('talent pool / evergreen'))
    return { kind: 'talent-pool', key: 'talent-pool' }
  if (status.startsWith('portal reports unavailable for application'))
    return { kind: 'unavailable', key: 'unavailable' }
  // Deadline/expiry warnings are calculated from the clock, not a new source availability claim.
  if (
    status === 'listed at last check; availability unconfirmed' ||
    status === 'listed with past deadline — review' ||
    status === 'listed after publication expiry — review; employer deadline unconfirmed'
  )
    return { kind: 'listed', key: 'listed' }
  return { kind: 'other', key: status }
}

function preservedTracking(prior: ResearchRow, next: ResearchRow): boolean {
  const fields = ['application_status', 'notes'].filter((field) => {
    const text = String(value(prior, field) ?? '').trim()
    return text !== '' && !(field === 'application_status' && text === 'To review')
  })
  return fields.length > 0 && fields.every((field) => value(prior, field) === value(next, field))
}

/** Compare only jobs candidate rows. The jobs extractor retains absent/out-of-scope prior rows. */
export function jobChanges(prior: ResearchDataset | null, next: ResearchDataset): JobChanges {
  const old = new Map(
    prior?.tables.find((table) => table.id === 'jobs')?.rows.map((row) => [row.id, row]),
  )
  const result: JobChanges = {
    added: 0,
    changed: 0,
    unchanged: 0,
    notFound: 0,
    returned: 0,
    trackingPreserved: 0,
    outsideSources: 0,
    rows: {},
  }
  for (const row of next.tables.find((table) => table.id === 'jobs')?.rows ?? []) {
    const previous = old.get(row.id),
      currentAvailability = availability(row),
      previousAvailability = previous ? availability(previous) : null,
      changes: JobFactChange[] = []
    if (previous && currentAvailability.kind !== 'outside-selected-sources') {
      for (const field of factFields)
        if (value(previous, field) !== value(row, field))
          changes.push({ field, previous: value(previous, field), current: value(row, field) })
      if (
        previousAvailability?.kind !== 'outside-selected-sources' &&
        previousAvailability?.key !== currentAvailability.key
      )
        changes.push({
          field: 'listing_status',
          previous: value(previous, 'listing_status'),
          current: value(row, 'listing_status'),
        })
    }
    let classification: JobChangeClassification
    if (currentAvailability.kind === 'outside-selected-sources') {
      classification = 'outside-selected-sources'
      result.outsideSources++
    } else if (!previous) {
      classification = 'added'
      result.added++
    } else if (
      currentAvailability.kind === 'not-found' &&
      previousAvailability?.kind !== 'not-found'
    ) {
      classification = 'not-found'
      result.notFound++
    } else if (
      previousAvailability?.kind === 'not-found' &&
      currentAvailability.kind !== 'not-found'
    ) {
      classification = 'returned'
      result.returned++
    } else if (changes.length) {
      classification = 'changed'
      result.changed++
    } else {
      classification = 'unchanged'
      result.unchanged++
    }
    const trackingPreserved = !!previous && preservedTracking(previous, row)
    if (trackingPreserved) result.trackingPreserved++
    result.rows[row.id] = {
      classification,
      availability: currentAvailability.kind,
      changedFields: changes.map((change) => change.field),
      changes,
      trackingPreserved,
    }
  }
  return result
}
