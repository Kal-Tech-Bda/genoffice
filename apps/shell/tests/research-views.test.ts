import { afterEach, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { datasetPage } from '../src/main/research/pages'
import { ResearchStore } from '../src/main/research/store'
import { cell, hash, quoteColumns } from '../src/main/research/extract'
import { jobChanges } from '../src/main/research/job-changes'
import type { ResearchConfig, ResearchDataset } from '../src/shared/research-api'

const stores: ResearchStore[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})
const config: ResearchConfig = {
  kind: 'jobs',
  instructions: '',
  sourceIds: [],
  fields: quoteColumns.map((c) => c.id),
  countries: [],
  fromYear: 2026,
  toYear: 2026,
  jobSiteIds: ['bma'],
}
function dataset(): ResearchDataset {
  return {
    schemaVersion: 1,
    issues: [],
    tables: [
      {
        id: 'jobs',
        name: 'Jobs',
        rowMeaning: 'Synthetic source listings',
        columns: [
          'title',
          'source_site',
          'role_group',
          'application_status',
          'closing_date',
          'notes',
          'listing_status',
        ].map((id) => ({ id, name: id, type: 'text' })),
        rows: Array.from({ length: 205 }, (_, i) => ({
          id: hash(String(i)).slice(0, 24),
          cells: {
            title: cell(i === 153 ? 'Needle Data Specialist' : `Role ${i}`, []),
            source_site: cell(i % 2 ? 'Source B' : 'Source A', []),
            role_group: cell(i % 3 ? 'Office / finance' : 'Data / research', []),
            application_status: cell(i === 153 ? 'Saved' : 'To review', []),
            notes: cell(i === 153 ? 'Review qualifications' : '', []),
            closing_date: cell(i === 153 ? '2026-10-21' : null, []),
            listing_status: cell('Listed at last check; availability unconfirmed', []),
          },
        })),
      },
      {
        id: 'job_sources',
        name: 'Sources',
        rowMeaning: 'Coverage',
        columns: [{ id: 'source', name: 'Source', type: 'text' }],
        rows: [{ id: hash('source').slice(0, 24), cells: { source: cell('Source B', []) } }],
      },
    ],
  }
}

it('finds a combined matching shortlist beyond the first page without filtering coverage or changing records', () => {
  const full = dataset(),
    before = JSON.stringify(full)
  const page = datasetPage(full, {
    view: {
      tableId: 'jobs',
      query: 'needle qualifications',
      roleGroups: ['Data / research'],
      sourceSites: ['Source B'],
      applicationStatus: 'Saved',
    },
  })!
  expect(page.tables[0].rows.map((r) => r.cells.title.value)).toEqual(['Needle Data Specialist'])
  expect(page.tables[0]).toMatchObject({ totalRows: 1, allRows: 205, offset: 0 })
  expect(page.tables[0].facets?.source_site).toEqual([
    { value: 'Source A', count: 103 },
    { value: 'Source B', count: 102 },
  ])
  expect(page.tables[1].rows).toHaveLength(1)
  expect(JSON.stringify(full)).toBe(before)
  expect(datasetPage(full)!.tables[0].totalRows).toBe(205)
})
it('filters and sorts the entire table before paging and keeps missing dates last in either direction', () => {
  const full = dataset()
  const asc = datasetPage(full, {
    tableId: 'jobs',
    view: {
      tableId: 'jobs',
      sourceSites: ['Source B'],
      sort: { columnId: 'title', direction: 'asc' },
    },
    offset: 100,
  })!.tables[0]
  expect(asc).toMatchObject({ totalRows: 102, allRows: 205, offset: 100 })
  expect(asc.rows.map((r) => r.cells.title.value)).toEqual(['Role 201', 'Role 203'])
  for (const direction of ['asc', 'desc'] as const)
    expect(
      datasetPage(full, {
        view: { tableId: 'jobs', sort: { columnId: 'closing_date', direction } },
      })!.tables[0].rows[0].cells.title.value,
    ).toBe('Needle Data Specialist')
  expect(() =>
    datasetPage(full, {
      view: { tableId: 'jobs', sort: { columnId: 'invented', direction: 'asc' } },
    }),
  ).toThrow('Unknown sort')
})
it('changes view isolates real facts and retained absence without discarding unchanged accepted data', () => {
  const prior = dataset(),
    next = structuredClone(prior)
  next.tables[0].rows[153].cells.closing_date.value = '2026-10-20'
  next.tables[0].rows[204].cells.listing_status.value =
    'Not found in latest check — review; not confirmed closed'
  const changes = jobChanges(prior, next)
  const page = datasetPage(next, { view: { tableId: 'jobs', changesOnly: true } }, changes)!
    .tables[0]
  expect(page.rows.map((r) => r.change?.kind)).toEqual(['changed', 'not-found'])
  expect(page.rows[0].change?.fields).toEqual(['closing_date'])
  expect(page).toMatchObject({ totalRows: 2, allRows: 205 })
  expect(() => datasetPage(prior, { view: { tableId: 'jobs', changesOnly: true } })).toThrow(
    'require a jobs candidate',
  )
})
it('migrates a version 2 ledger without altering accepted rows and persists workflow-scoped view CRUD across restart', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'infomonk-views-')), 'ledger.sqlite')
  let store = new ResearchStore(path)
  const first = store.save('project-one', 'Jobs', config),
    second = store.save('project-two', 'Jobs', config)
  const run = store.queue(first.id, false),
    accepted = dataset()
  store.review(run.id, accepted, { total: 1, complete: 1, failed: 0 })
  store.publish(run.id, accepted, 'unchanged.xlsx')
  store.db.exec('DROP TABLE saved_views; PRAGMA user_version=2;')
  store.close()
  store = new ResearchStore(path)
  stores.push(store)
  expect(store.accepted(first.id)).toEqual(accepted)
  const saved = store.saveView('project-one', first.id, 'Data shortlist', {
    tableId: 'jobs',
    roleGroups: ['Data / research'],
    applicationStatus: 'Saved',
  })
  expect(() => store.views('project-two', first.id)).toThrow('this project')
  expect(() =>
    store.saveView('project-two', second.id, 'Stolen', { tableId: 'jobs' }, saved.id),
  ).toThrow('this workflow')
  store.close()
  stores.pop()
  store = new ResearchStore(path)
  stores.push(store)
  expect(store.views('project-one', first.id)).toEqual([saved])
  store.saveView('project-one', first.id, 'Renamed', { tableId: 'jobs', query: 'needle' }, saved.id)
  expect(store.views('project-one', first.id)[0].name).toBe('Renamed')
  store.deleteView('project-one', first.id, saved.id)
  expect(store.views('project-one', first.id)).toEqual([])
  expect(store.workflow(first.id).acceptedRevision).toBe(1)
  expect(store.accepted(first.id)).toEqual(accepted)
})
