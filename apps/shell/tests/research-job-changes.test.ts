import { expect, it } from 'vitest'
import { jobChanges } from '../src/main/research/job-changes'
import type { ResearchDataset, ResearchRow, ResearchValue } from '../src/shared/research-api'

function row(id: string, overrides: Record<string, ResearchValue> = {}): ResearchRow {
  const values = {
    job_key: `bma:${id}`,
    title: 'Systems Analyst',
    employer: 'BMA',
    location: 'Bermuda',
    closing_date: '2026-10-20',
    posted_date: '2026-10-01',
    advertiser: null,
    advert_expiry: null,
    listing_status: 'Listed at last check; availability unconfirmed',
    deadline_status: 'Future deadline',
    first_seen: '2026-10-10T20:00:00Z',
    last_seen: '2026-10-10T20:00:00Z',
    last_checked: '2026-10-10T20:00:00Z',
    application_status: 'To review',
    notes: '',
    ...overrides,
  }
  return {
    id,
    cells: Object.fromEntries(
      Object.entries(values).map(([field, value]) => [
        field,
        {
          value,
          missingReason: value === null ? 'Not stated on checked listing' : null,
          issues: [],
          evidence: [
            {
              sourceId: 'source',
              sourceVersion: 'old-bytes',
              sourceName: 'BMA',
              uri: 'https://jobs.jobvite.com/bmacareers/job/IT123',
              retrievedAt: '2026-10-10T20:00:00Z',
              locator: `field:${field}`,
              excerpt: String(value),
              method: 'bermuda-jobs-bma-v1',
            },
          ],
          origin: field === 'application_status' || field === 'notes' ? 'internal' : 'external',
        },
      ]),
    ),
  }
}

function dataset(...rows: ResearchRow[]): ResearchDataset {
  return {
    schemaVersion: 1,
    tables: [{ id: 'jobs', name: 'Jobs', rowMeaning: 'Source listings', columns: [], rows }],
    issues: [],
  }
}

it('treats identical facts with new acquisition timestamps and source bytes as unchanged', () => {
  const first = row('stable'),
    checked = row('stable', {
      first_seen: '2026-10-09T20:00:00Z',
      last_seen: '2026-10-11T20:00:00Z',
      last_checked: '2026-10-11T20:00:00Z',
    })
  for (const cell of Object.values(checked.cells)) {
    cell.evidence[0].sourceVersion = 'new-bytes'
    cell.evidence[0].retrievedAt = '2026-10-11T20:00:00Z'
    cell.evidence[0].locator = 'new DOM location'
    cell.missingReason = cell.value === null ? 'Not disclosed in latest response' : null
  }
  const changes = jobChanges(dataset(first), dataset(checked))
  expect(changes).toMatchObject({ added: 0, changed: 0, unchanged: 1, notFound: 0, returned: 0 })
  expect(changes.rows.stable).toMatchObject({ classification: 'unchanged', changes: [] })
})

it('shows an actual source deadline change with the old and new values', () => {
  const changes = jobChanges(
    dataset(row('stable')),
    dataset(row('stable', { closing_date: '2026-10-21' })),
  )
  expect(changes.changed).toBe(1)
  expect(changes.rows.stable).toMatchObject({
    classification: 'changed',
    changedFields: ['closing_date'],
    changes: [{ field: 'closing_date', previous: '2026-10-20', current: '2026-10-21' }],
  })
})

it('separates a newly absent listing from a repeat absence and an observed return without claiming closure', () => {
  const seen = dataset(row('stable')),
    absent = dataset(
      row('stable', { listing_status: 'Not found in latest check — review; not confirmed closed' }),
    )
  const missing = jobChanges(seen, absent)
  expect(missing).toMatchObject({ changed: 0, notFound: 1, returned: 0, unchanged: 0 })
  expect(missing.rows.stable).toMatchObject({
    classification: 'not-found',
    availability: 'not-found',
    changedFields: ['listing_status'],
  })
  expect(jobChanges(absent, structuredClone(absent))).toMatchObject({ notFound: 0, unchanged: 1 })
  const returned = jobChanges(absent, seen)
  expect(returned).toMatchObject({ added: 0, changed: 0, notFound: 0, returned: 1 })
  expect(returned.rows.stable.classification).toBe('returned')
  expect(returned.rows.stable.availability).toBe('listed')
})

it('does not count clock-derived deadline or publication warnings as new listing facts', () => {
  const first = dataset(row('deadline'))
  for (const status of [
    'Listed with past deadline — review',
    'Listed after publication expiry — review; employer deadline unconfirmed',
  ])
    expect(
      jobChanges(
        first,
        dataset(row('deadline', { listing_status: status, deadline_status: 'Past deadline' })),
      ),
    ).toMatchObject({ changed: 0, unchanged: 1 })
})

it('counts preserved personal tracking once per meaningful row and ignores its edits in facts', () => {
  const tracked = row('saved', {
      application_status: 'Saved',
      notes: 'Confirm permit requirement',
    }),
    defaults = row('default')
  const preserved = jobChanges(
    dataset(tracked, defaults),
    dataset(structuredClone(tracked), structuredClone(defaults)),
  )
  expect(preserved).toMatchObject({ unchanged: 2, trackingPreserved: 1 })
  expect(preserved.rows.saved.trackingPreserved).toBe(true)
  expect(preserved.rows.default.trackingPreserved).toBe(false)
  const noteEdit = jobChanges(
    dataset(tracked),
    dataset(row('saved', { application_status: 'Applied', notes: 'Updated personal note' })),
  )
  expect(noteEdit).toMatchObject({ changed: 0, unchanged: 1, trackingPreserved: 0 })
  expect(noteEdit.rows.saved.changedFields).toEqual([])
})

it('retains tracking on a missing row and classifies excluded sources independently of disappearance', () => {
  const saved = row('saved', { application_status: 'Saved', notes: 'Compare qualifications' }),
    outside = structuredClone(saved),
    missing = structuredClone(saved)
  outside.cells.listing_status.value = 'Outside selected sources — retained'
  missing.cells.listing_status.value = 'Not found in latest check — review; not confirmed closed'
  const excluded = jobChanges(dataset(saved), dataset(outside))
  expect(excluded).toMatchObject({
    outsideSources: 1,
    notFound: 0,
    changed: 0,
    trackingPreserved: 1,
  })
  expect(excluded.rows.saved).toMatchObject({
    classification: 'outside-selected-sources',
    changedFields: [],
  })
  expect(jobChanges(dataset(outside), dataset(saved))).toMatchObject({ returned: 0, unchanged: 1 })
  expect(jobChanges(dataset(saved), dataset(missing))).toMatchObject({
    notFound: 1,
    trackingPreserved: 1,
  })
})

it('reports first-run jobs as additions and ignores source coverage and unrelated research tables', () => {
  const next = dataset(row('one'), row('two'))
  next.tables.push(
    {
      id: 'job_sources',
      name: 'Coverage',
      rowMeaning: 'Sites',
      columns: [],
      rows: [row('source')],
    },
    { id: 'quotes', name: 'Quotes', rowMeaning: 'Quotes', columns: [], rows: [row('quote')] },
  )
  expect(jobChanges(null, next)).toMatchObject({ added: 2, changed: 0, trackingPreserved: 0 })
  expect(Object.keys(jobChanges(null, next).rows)).toEqual(['one', 'two'])
  expect(jobChanges(null, { ...next, tables: next.tables.slice(1) }).added).toBe(0)
})

it('counts a real availability flag change while retaining distinct source keys for duplicate-looking jobs', () => {
  const old = dataset(row('a'), row('b')),
    next = dataset(
      row('a', { listing_status: 'Portal reports unavailable for application — review' }),
      row('b'),
    )
  const changes = jobChanges(old, next)
  expect(changes).toMatchObject({ changed: 1, unchanged: 1 })
  expect(changes.rows.a).toMatchObject({
    availability: 'unavailable',
    changedFields: ['listing_status'],
  })
  expect(changes.rows.b.classification).toBe('unchanged')
  const talent = jobChanges(
    old,
    dataset(
      row('a', { listing_status: 'Talent pool / evergreen — not confirmed current vacancy' }),
      row('b'),
    ),
  )
  expect(talent.rows.a).toMatchObject({ classification: 'changed', availability: 'talent-pool' })
})
