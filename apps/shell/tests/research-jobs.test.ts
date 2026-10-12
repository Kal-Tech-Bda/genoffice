import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  parseJobPage,
  jobUrl,
  fetchJobPage,
  jobDataset,
  jobSite,
  type JobObservation,
} from '../src/main/research/jobs'
import { WorkspaceStore } from '../src/main/workspace-store'
import { ResearchService } from '../src/main/research/service'
import { hash } from '../src/main/research/extract'
import type { ResearchConfig } from '../src/shared/research-api'
import { publicHtml } from '@genoffice/electron-utils/public-html'
import JSZip from 'jszip'
import { DatabaseSync } from 'node:sqlite'
const bmaList = '<h1>Open Positions</h1><a href="/bmacareers/job/IT123">Systems Analyst</a>'
const bmaDetail = (closing = '16 October 2026') =>
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Systems Analyst', datePosted: '2026-10-02', hiringOrganization: 'BMA', jobLocation: [{ address: { addressCountry: 'Bermuda' } }] })}</script><p>Applications must be received no later than ${closing}.</p>`
const cgList =
  '<h2>Current Vacancies</h2><table><tr><td><a href="/recruit/fRecruit__ApplyJob?vacancyNo=VN123&portal=CGI">Project Manager</a></td><td>CG</td><td>All Jurisdictions</td><td>22 October 2026</td></tr><tr><td><a href="/recruit/fRecruit__ApplyJob?vacancyNo=VN999&portal=CGI">Accountant</a></td><td>CG</td><td>Bahamas</td><td>22 October 2026</td></tr></table><p>Page 1 of 1</p>'
const cgDetail =
  '<script type="application/ld+json">{"@type":"JobPosting","title":"Project Manager","datePosted":"2026-10-06","validThrough":"2026-10-22T00:00:00Z"}</script><table><tr><th>Company Name</th><td>CG</td></tr><tr><th>Jurisdiction</th><td>All Jurisdictions</td></tr><tr><th>Application Closing Date</th><td>22 October 2026</td></tr></table>'
const expertise = (title = 'Data Analyst') =>
  `<h2>Available Jobs</h2><div class="s-item-text"><div class="s-rich-text-wrapper"><p style="font-size:14px">${title}</p><p style="font-size:12px">Bermuda</p><p>Download job description</p><p style="font-size:14px">Legal Secretary (Bermuda)</p><p style="font-size:12px">Cayman</p><p style="font-size:14px">Accountant</p><p style="font-size:12px">Cayman</p></div></div>`
const services: ResearchService[] = []

it('requires a fresh jobs run after provenance rules change while preserving accepted history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-jobs-version-')),
    workspace = new WorkspaceStore(root)
  const project = await workspace.create({
    name: 'Version fence',
    description: '',
    startKind: 'researchWeb',
  })
  const service = new ResearchService(root, workspace)
  services.push(service)
  const workflow = service.save(project.id, 'Jobs', {
    kind: 'jobs',
    instructions: 'Technology and office',
    sourceIds: [],
    fields: [],
    countries: [],
    fromYear: 2023,
    toYear: 2024,
    jobSiteIds: ['bma'],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(url === jobSite('bma').url ? bmaList : bmaDetail(), {
          headers: { 'content-type': 'text/html' },
        }),
    ),
  )
  const first = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(first.id).status).toBe('review'))
  await service.publish(project.id, first.id, true, false)
  const accepted = service.store.accepted(workflow.id)
  const pending = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(pending.id).status).toBe('review'))
  const legacy = new DatabaseSync(join(root, 'infomonk-research.sqlite'))
  try {
    legacy
      .prepare('UPDATE runs SET processing_version=? WHERE id=?')
      .run('bermuda-jobs-2/schema-2', pending.id)
  } finally {
    legacy.close()
  }
  await expect(service.publish(project.id, pending.id, true, false)).rejects.toThrow(/obsolete/i)
  expect(service.store.accepted(workflow.id)).toEqual(accepted)
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(1)
  service.store.cancel(pending.id)
  const fresh = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(fresh.id).status).toBe('review'))
  expect(service.store.run(fresh.id).processingVersion).toBe('bermuda-jobs-3/schema-2')
  await service.publish(project.id, fresh.id, true, false)
  const current = service.store.accepted(workflow.id)!.tables[0].rows[0]
  expect(current.id).toBe(accepted!.tables[0].rows[0].id)
  expect(current.cells.title.value).toBe('Systems Analyst')
  expect(current.cells.closing_date.value).toBe('2026-10-16')
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(2)
})
afterEach(() => {
  for (const service of services.splice(0)) {
    service.close()
    service.store.close()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function observe(
  site: 'bma' | 'coralisle' | 'expertise',
  html: string,
  url = jobSite(site).url,
  at = '2026-10-11T22:00:00Z',
): JobObservation {
  return {
    site,
    page: parseJobPage(site, Buffer.from(html), url),
    source: {
      sourceId: hash(url),
      sourceVersion: hash(html),
      sourceName: site,
      uri: url,
      retrievedAt: at,
    },
  }
}
it('parses real site shapes, keeps uncertain locations visible, rejects non-Bermuda listings and preserves missing facts', () => {
  expect(parseJobPage('bma', Buffer.from(bmaList), jobSite('bma').url).links).toEqual([
    'https://jobs.jobvite.com/bmacareers/job/IT123',
  ])
  const cg = observe('coralisle', cgList)
  expect(cg.page.links).toHaveLength(1)
  const detail = observe('coralisle', cgDetail, cg.page.links[0])
  expect(detail.page.entries[0]).toMatchObject({
    employer: 'CG',
    location: 'All Jurisdictions',
    closing_date: '2026-10-22',
  })
  const agency = observe('expertise', expertise())
  expect(agency.page.entries).toHaveLength(2)
  expect(agency.page.entries[1].issues.join(' ')).toContain('location disagree')
  const dataset = jobDataset([cg, detail, agency], null, ['coralisle', 'expertise'])
  expect(dataset.tables[0].rows[0].cells.location.issues).toContain(
    'Confirm the Bermuda location before applying.',
  )
  expect(dataset.tables[0].rows[1].cells.employer.value).toBeNull()
  expect(dataset.tables[0].rows[1].cells.closing_date.value).toBeNull()
})
it('retains first/last seen on disappearance without claiming closure and does not refresh excluded source timestamps', () => {
  const first = jobDataset([observe('expertise', expertise())], null, ['expertise'])
  const next = jobDataset(
    [observe('expertise', expertise('Systems Administrator'), undefined, '2026-10-12T22:00:00Z')],
    first,
    ['expertise'],
  )
  const absent = next.tables[0].rows.find((r) => r.cells.title.value === 'Data Analyst')!
  expect(absent.cells.listing_status.value).toContain('Not found in latest check')
  expect(absent.cells.last_seen.value).toBe('2026-10-11T22:00:00Z')
  expect(absent.cells.last_checked.value).toBe('2026-10-12T22:00:00Z')
  const outside = jobDataset([observe('bma', bmaList)], first, ['bma']).tables[0].rows[0]
  expect(outside.cells.listing_status.value).toContain('Outside selected sources')
  expect(outside.cells.last_checked.value).toBe('2026-10-11T22:00:00Z')
})
it('treats the closing day in Bermuda as due today rather than premature closure', () => {
  const page = observe(
    'bma',
    bmaDetail('11 October 2026'),
    'https://jobs.jobvite.com/bmacareers/job/IT123',
    '2026-10-12T01:00:00Z',
  )
  const row = jobDataset([page], null, ['bma']).tables[0].rows[0]
  expect(row.cells.deadline_status.value).toBe('Due today')
  expect(row.cells.listing_status.value).toContain('availability unconfirmed')
})
it('fails closed on pagination, unknown layout, duplicate keys and resource bounds', () => {
  expect(() =>
    parseJobPage(
      'bma',
      Buffer.from(bmaList + '<a href="/bmacareers/jobs?page=2">Next</a>'),
      jobSite('bma').url,
    ),
  ).toThrow('pagination')
  expect(() =>
    parseJobPage(
      'coralisle',
      Buffer.from(cgList.replace('Page 1 of 1', 'Page 1 of 2')),
      jobSite('coralisle').url,
    ),
  ).toThrow('pagination')
  expect(() =>
    parseJobPage('expertise', Buffer.from('<h2>Access denied</h2>'), jobSite('expertise').url),
  ).toThrow('layout')
  expect(() =>
    parseJobPage('expertise', Buffer.from(expertise() + expertise()), jobSite('expertise').url),
  ).toThrow('Duplicate listing keys')
  expect(() => publicHtml(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow('2 MiB')
  expect(() => publicHtml(Buffer.from('<div>'.repeat(210)))).toThrow('structure')
})
it('only fetches confirmed public routes, rejects redirects/non-HTML and caps streamed bytes', async () => {
  for (const [site, url] of [
    ['bma', 'http://localhost/jobs'],
    ['bma', 'https://jobs.jobvite.com.evil.test/bmacareers/jobs'],
    ['bma', 'https://jobs.jobvite.com/bmacareers/job/IT123/apply'],
    [
      'coralisle',
      'https://fs-320.my.salesforce-sites.com/recruit/fRecruit__ApplyJob?vacancyNo=VN1&portal=CGI&portal=NO',
    ],
  ] as const)
    expect(() => jobUrl(site, url)).toThrow()
  const fetch = vi.fn(
    async () => new Response('Denied', { status: 403, headers: { 'content-type': 'text/html' } }),
  )
  vi.stubGlobal('fetch', fetch)
  await expect(
    fetchJobPage('bma', jobSite('bma').url, new AbortController().signal),
  ).rejects.toThrow('HTTP 403')
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', credentials: 'omit' })
  fetch.mockImplementation(
    async () => new Response('binary', { headers: { 'content-type': 'application/pdf' } }),
  )
  await expect(
    fetchJobPage('bma', jobSite('bma').url, new AbortController().signal),
  ).rejects.toThrow('not HTML')
  fetch.mockImplementation(
    async () =>
      new Response(new Uint8Array(2 * 1024 * 1024 + 1), {
        headers: { 'content-type': 'text/html' },
      }),
  )
  await expect(
    fetchJobPage('bma', jobSite('bma').url, new AbortController().signal),
  ).rejects.toThrow('response larger')
})
it('reuses the ledger for sample/full, source evidence, persistent application tracking, failed refresh and retained disappeared listings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-jobs-')),
    workspace = new WorkspaceStore(root)
  const project = await workspace.create({
    name: 'Bermuda jobs',
    description: 'Synthetic process test',
    startKind: 'researchWeb',
  })
  const service = new ResearchService(root, workspace)
  services.push(service)
  const config: ResearchConfig = {
    kind: 'jobs',
    instructions: 'Technology, data and office roles',
    sourceIds: [],
    fields: [],
    countries: [],
    fromYear: 2023,
    toYear: 2024,
    jobSiteIds: ['bma', 'coralisle', 'expertise'],
  }
  const workflow = service.save(project.id, 'Jobs', config)
  let second = false,
    unavailable = false
  const fetch = vi.fn(async (url: string) => {
    if (unavailable && url === jobSite('coralisle').url) throw Error('Source offline')
    const html =
      url === jobSite('bma').url
        ? bmaList
        : url.includes('/bmacareers/job/')
          ? bmaDetail()
          : url.includes('ApplyJobList')
            ? cgList
            : url.includes('ApplyJob?')
              ? cgDetail
              : expertise(second ? 'Systems Administrator' : 'Data Analyst')
    return new Response(html, { headers: { 'content-type': 'text/html' } })
  })
  vi.stubGlobal('fetch', fetch)
  const sample = service.run(project.id, workflow.id, true)
  await vi.waitFor(() => expect(service.store.run(sample.id).status).toBe('review'))
  await expect(service.publish(project.id, sample.id, true, false)).rejects.toThrow(
    'Samples cannot publish',
  )
  const full = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(full.id).status).toBe('review'))
  expect(service.store.run(sample.id).status).toBe('obsolete')
  const output = await service.publish(project.id, full.id, true, false)
  const zip = await JSZip.loadAsync(readFileSync(output))
  expect(
    JSON.parse(await zip.file('infomonk/research.json')!.async('string')).attribution,
  ).toContain('Public career-site listings')
  const data = service.store.accepted(workflow.id)!,
    analyst = data.tables[0].rows.find((r) => r.cells.title.value === 'Data Analyst')!
  expect((await service.evidence(project.id, analyst.cells.title.evidence[0])).text).toBe(
    'Data Analyst',
  )
  await service.correct(
    project.id,
    workflow.id,
    'jobs',
    analyst.id,
    'application_status',
    'Saved',
    'Review the requirements first',
  )
  await service.correct(
    project.id,
    workflow.id,
    'jobs',
    analyst.id,
    'notes',
    'Compare qualifications; no application sent',
    'Personal tracking note',
  )
  await expect(
    service.correct(
      project.id,
      workflow.id,
      'jobs',
      analyst.id,
      'listing_status',
      'Closed',
      'Wrong inference',
    ),
  ).rejects.toThrow('identity')
  await expect(
    service.correct(
      project.id,
      workflow.id,
      'jobs',
      analyst.id,
      'application_status',
      'Anything',
      'Invalid',
    ),
  ).rejects.toThrow('supported application')
  const revision = service.store.workflow(workflow.id).acceptedRevision,
    accepted = service.store.accepted(workflow.id)
  unavailable = true
  const failed = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(failed.id).status).toBe('failed'))
  await expect(service.publish(project.id, failed.id, true, false)).rejects.toThrow('Run is failed')
  expect(service.store.accepted(workflow.id)).toEqual(accepted)
  unavailable = false
  second = true
  const refresh = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(refresh.id).status).toBe('review'))
  await service.publish(project.id, refresh.id, true, false)
  const retained = service.store
    .accepted(workflow.id)!
    .tables[0].rows.find((r) => r.id === analyst.id)!
  expect(retained.cells.listing_status.value).toContain('Not found in latest check')
  expect(retained.cells.application_status.value).toBe('Saved')
  expect(retained.cells.notes.value).toBe('Compare qualifications; no application sent')
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(revision + 1)
  expect(service.store.inputs(refresh.id).length).toBe(5)
})
it.skipIf(process.env.INFOMONK_PROBE_JOBS !== '1')(
  'parses separately captured live primary pages',
  () => {
    const dir = resolve('../../e2e/artifacts/jobs-probe')
    for (const [site, file, url] of [
      ['bma', 'bma', jobSite('bma').url],
      ['bma', 'bma-detail', 'https://jobs.jobvite.com/bmacareers/job/ohrTAfwV'],
      ['coralisle', 'cg', jobSite('coralisle').url],
      [
        'coralisle',
        'cg-detail',
        'https://fs-320.my.salesforce-sites.com/recruit/fRecruit__ApplyJob?portal=CGI&vacancyNo=VN596',
      ],
      ['expertise', 'expertise-jobs', jobSite('expertise').url],
    ] as const) {
      const page = parseJobPage(site, readFileSync(join(dir, file + '.html')), url)
      expect(page.links.length + page.entries.length).toBeGreaterThan(0)
      console.log(
        site,
        file,
        page.entries.map((e) => ({
          title: e.title,
          location: e.location,
          deadline: e.closing_date,
        })),
        page.links.length,
      )
    }
  },
)
it('resolves public JSON job evidence through immutable stored units and rejects a forged locator', async () => {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-json-jobs-')),
    workspace = new WorkspaceStore(root)
  const project = await workspace.create({
    name: 'Public JSON jobs',
    description: 'Synthetic evidence test',
    startKind: 'researchWeb',
  })
  const service = new ResearchService(root, workspace)
  services.push(service)
  const workflow = service.save(project.id, 'JSON Jobs', {
    kind: 'jobs',
    instructions: 'Data roles',
    sourceIds: [],
    fields: [],
    countries: [],
    fromYear: 2023,
    toYear: 2024,
    jobSiteIds: ['onecomm'],
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/list')
              ? { meta: { totalCount: 1 }, result: [{ id: '124' }] }
              : {
                  result: {
                    jobOpening: {
                      jobOpeningName: 'Data Analyst',
                      jobOpeningShareUrl: 'https://onecomm.bamboohr.com/careers/124',
                      jobOpeningStatus: 'Open',
                      location: { city: 'Hamilton', addressCountry: 'Bermuda' },
                    },
                  },
                },
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    ),
  )
  const run = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(run.id).status).toBe('review'))
  const evidence = service.store.run(run.id).candidate!.tables[0].rows[0].cells.title.evidence[0]
  expect((await service.evidence(project.id, evidence)).text).toBe('"Data Analyst"')
  await expect(
    service.evidence(project.id, { ...evidence, excerpt: '"Fabricated"' }),
  ).rejects.toThrow('locator')
})
