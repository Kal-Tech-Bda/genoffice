import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { JOB_SITES } from '../src/shared/jobs-api'
import { jobSite, jobStartUrl, jobUrl } from '../src/main/research/job-routes'
import { parseJobPage, jobDataset } from '../src/main/research/jobs'
import { jobScope } from '../src/main/research/job-scope'

const bytes = (value: unknown) => Buffer.from(JSON.stringify(value))
it('distinguishes digital/data/office, adjacent quantitative and mixed advertisements without matching ordinary trades', () => {
  expect(jobScope('BUSINESS INTELLIGENCE SPECIALIST')).toBe('Data / research')
  expect(jobScope('Intermediate Infrastructure Engineer')).toBe('Technology')
  expect(jobScope('FRONT DESK RECEPTIONIST – BOOKKEEPER')).toBe('Office / finance')
  expect(jobScope('Senior Actuary')).toContain('adjacent')
  expect(jobScope('Actuarial Analytics Analyst')).toContain('adjacent')
  expect(jobScope('Investment Analyst')).toContain('domain review')
  expect(jobScope('Operations Manager – Chef de parties – Butcher')).toContain('scope review')
  expect(jobScope('Veterinary Technician')).toBeNull()
  expect(jobScope('Landscape Horticulturist')).toBeNull()
})
it('supports every registered source while fencing schemes, hosts, authentication and application routes', () => {
  for (const site of JOB_SITES)
    expect(new URL(jobUrl(site.id, jobStartUrl(site.id))).protocol).toBe('https:')
  for (const [site, url] of [
    ['onecomm', 'https://onecomm.bamboohr.com/careers/124/apply'],
    [
      'artex',
      'https://phe.tbe.taleo.net/phe03/ats/careers/v2/applyRequisition?org=FRONTIER&cws=40&rid=222',
    ],
    ['axis', 'https://axiscapital.wd1.myworkdayjobs.com/axiscareers/job/Bermuda/Role_REQ123/apply'],
    ['axis', jobStartUrl('axis') + '?facet=locations&value=not-a-public-id'],
    ['deloitte', 'https://talentsourcing.deloitte.com/cbcapply/CandidateRegistration'],
    ['jobsinbda', 'https://www.jobsinbda.com/wp-admin/admin-ajax.php?action=create_account'],
    ['chubb', jobStartUrl('chubb').replace('keyword=Bermuda', 'keyword=other')],
  ] as const)
    expect(() => jobUrl(site, url)).toThrow()
})
it('follows WordPress public pagination, keeps expiry separate from deadline, and does not infer a role location', () => {
  const list = parseJobPage(
    'jobsinbda',
    bytes({
      found_jobs: true,
      max_num_pages: 3,
      html: '<li class="job_listing"><a href="/job/data-analyst/"><h3>Data Analyst</h3></a></li>',
    }),
    jobStartUrl('jobsinbda'),
  )
  expect(list.links).toHaveLength(3)
  expect(list.links.some((l) => new URL(l).searchParams.get('page') === '3')).toBe(true)
  const detail = parseJobPage(
    'jobsinbda',
    Buffer.from(
      '<script type="application/ld+json">{"@type":"JobPosting","title":"Data Analyst","datePosted":"2026-10-10","validThrough":"2026-10-11","hiringOrganization":{"name":""}}</script>',
    ),
    'https://www.jobsinbda.com/job/data-analyst/',
  )
  const row = detail.entries[0]
  expect(row).toMatchObject({ closing_date: null, advert_expiry: '2026-10-11', employer: null })
  expect(row.location).toContain('Not stated')
  expect(row.issues.join(' ')).toContain('publication expiry')
  expect(() =>
    parseJobPage(
      'jobsinbda',
      bytes({ found_jobs: true, max_num_pages: 1, html: '<p>Changed layout</p>' }),
      jobStartUrl('jobsinbda'),
    ),
  ).toThrow('layout')
})
it('selects verified Bermuda Workday facets, checks full page counts, and records the no-facet observation', () => {
  const base = jobStartUrl('axis'),
    value = 'a'.repeat(32)
  const first = parseJobPage(
    'axis',
    bytes({
      total: 60,
      jobPostings: [],
      facets: [
        { facetParameter: 'locations', values: [{ descriptor: 'Bermuda', id: value, count: 21 }] },
      ],
    }),
    base,
  )
  expect(new URL(first.links[0]).searchParams.get('value')).toBe(value)
  const postings = Array.from({ length: 20 }, (_, i) => ({
    externalPath: `/job/Bermuda/Role_REQ${i}`,
  }))
  const selected = parseJobPage('axis', bytes({ total: 21, jobPostings: postings }), first.links[0])
  expect(selected.links).toHaveLength(21)
  expect(selected.links.some((l) => new URL(l).searchParams.get('offset') === '20')).toBe(true)
  expect(() =>
    parseJobPage('axis', bytes({ total: 21, jobPostings: postings.slice(1) }), first.links[0]),
  ).toThrow('coverage')
  const absent = parseJobPage(
    'axis',
    bytes({
      total: 8,
      jobPostings: [],
      facets: [
        {
          facetParameter: 'locationCountry',
          values: [{ descriptor: 'United Kingdom', id: value, count: 8 }],
        },
      ],
    }),
    base,
  )
  expect(absent.entries).toEqual([])
  expect(absent.scopeNote).toContain('did not expose a Bermuda')
})
it('rejects incomplete BambooHR list responses and excludes explicitly non-Bermuda role details', () => {
  expect(() =>
    parseJobPage(
      'onecomm',
      bytes({ meta: { totalCount: 2 }, result: [{ id: '124' }] }),
      jobStartUrl('onecomm'),
    ),
  ).toThrow('coverage')
  const detail = {
    result: {
      jobOpening: {
        jobOpeningName: 'Data Analyst',
        jobOpeningShareUrl: 'https://onecomm.bamboohr.com/careers/124',
        jobOpeningStatus: 'Open',
        location: { city: 'Toronto', addressCountry: 'Canada' },
      },
    },
  }
  expect(
    parseJobPage('onecomm', bytes(detail), 'https://onecomm.bamboohr.com/careers/124/detail')
      .entries,
  ).toEqual([])
})
it('ignores pagination-shaped login links and retains a Bermuda country with a parish-only Workday location', () => {
  const page = parseJobPage(
    'deloitte',
    Buffer.from(
      '<h1>Search for open positions</h1><a href="https://talentsourcing.deloitte.com/cbcapply/Login?pipelineOffset=6&pipelineRecordsPerPage=6">Login</a><a href="https://talentsourcing.deloitte.com/cbcapply/SearchJobs/?pipelineOffset=12&pipelineRecordsPerPage=6">Next</a>',
    ),
    jobStartUrl('deloitte'),
  )
  expect(page.links).toHaveLength(1)
  expect(page.links[0]).toContain('/SearchJobs?')
  expect(
    jobUrl('deloitte', jobStartUrl('deloitte') + '/?pipelineOffset=0&pipelineRecordsPerPage=6'),
  ).toBe(jobStartUrl('deloitte'))
  const detail = parseJobPage(
    'axis',
    bytes({
      jobPostingInfo: {
        title: 'Data Analyst',
        jobReqId: 'REQ123',
        country: { descriptor: 'Bermuda' },
        location: 'Pembroke',
        externalUrl:
          'https://axiscapital.wd1.myworkdayjobs.com/axiscareers/job/Pembroke/Data-Analyst_REQ123',
      },
    }),
    'https://axiscapital.wd1.myworkdayjobs.com/wday/cxs/axiscapital/axiscareers/job/Pembroke/Data-Analyst_REQ123',
  )
  expect(detail.entries[0].location).toBe('Pembroke; Bermuda')
})
it('labels partial guest coverage and separates a recruiter advertiser from an unconfirmed employer', () => {
  const html =
    '<h1>272 Jobs in Bermuda</h1><ul class="jobs-search__results-list"><li><div class="base-card" data-entity-urn="urn:li:jobPosting:123"><a class="base-card__full-link" href="https://bm.linkedin.com/jobs/view/data-analyst-123?trackingId=foo"></a><h3 class="base-search-card__title">Data Analyst</h3><h4 class="base-search-card__subtitle">Recruiter</h4><span class="job-search-card__location">Hamilton, Bermuda</span><time datetime="2026-10-10">Yesterday</time></div></li></ul>'
  const page = parseJobPage('linkedin', Buffer.from(html), jobStartUrl('linkedin'))
  expect(page.scopeNote).toContain('PARTIAL guest search: 1')
  expect(page.entries[0]).toMatchObject({
    employer: null,
    advertiser: 'Recruiter',
    posted_date: '2026-10-10',
    listing_url: 'https://bm.linkedin.com/jobs/view/data-analyst-123',
  })
  expect(() =>
    parseJobPage('linkedin', Buffer.from('<h1>Sign in</h1>'), jobStartUrl('linkedin')),
  ).toThrow('unavailable')
  expect(() =>
    jobUrl('linkedin', 'https://bm.linkedin.com/jobs/view/data-analyst-123/apply'),
  ).toThrow()
})
it('reads an employer deadline in a span and labels an expired still-listed role for review', () => {
  const page = parseJobPage(
    'clarien',
    Buffer.from(
      '<div><h3>Intermediate Infrastructure Engineer</h3><div><span>Closing date: 2026-10-09</span></div></div>',
    ),
    jobStartUrl('clarien'),
  )
  expect(page.entries[0].closing_date).toBe('2026-10-09')
  const d = jobDataset(
    [
      {
        site: 'clarien',
        page,
        source: {
          sourceId: 'clarien',
          sourceVersion: 'a'.repeat(64),
          sourceName: 'Clarien',
          uri: jobStartUrl('clarien'),
          retrievedAt: '2026-10-11T22:00:00Z',
        },
      },
    ],
    null,
    ['clarien'],
  )
  expect(d.tables[0].rows[0].cells.deadline_status.value).toBe('Past deadline')
  expect(d.tables[0].rows[0].cells.listing_status.value).toContain('past deadline')
})
it('does not convert a repost-key caveat into a location warning for an explicit Bermuda role', () => {
  const page = parseJobPage(
    'expertise',
    Buffer.from(
      '<h2>Available Jobs</h2><div class="s-item-text"><div class="s-rich-text-wrapper"><p style="font-size:14px">Data Analyst</p><p>Bermuda</p></div></div>',
    ),
    jobStartUrl('expertise'),
  )
  expect(page.entries[0].issues.join(' ')).toContain('title/location')
  const d = jobDataset(
    [
      {
        site: 'expertise',
        page,
        source: {
          sourceId: 'expertise',
          sourceVersion: 'a'.repeat(64),
          sourceName: 'Expertise',
          uri: jobStartUrl('expertise'),
          retrievedAt: '2026-10-11T22:00:00Z',
        },
      },
    ],
    null,
    ['expertise'],
  )
  expect(d.tables[0].rows[0].cells.location.issues).toEqual([])
})
it('treats a multi-line agency heading as one listing and preserves different qualification suffixes', () => {
  const html =
    '<h2>Available Jobs</h2><div class="s-item-text"><div class="s-rich-text-wrapper">' +
    ['P&C', 'Life & Annuities']
      .map(
        (s) =>
          `<p style="font-size:14px">(Senior) Actuarial Associates &amp;</p><p style="font-size:14px">Qualified Actuaries - ${s}</p><p>Bermuda</p>`,
      )
      .join('') +
    '</div></div>'
  const page = parseJobPage('expertise', Buffer.from(html), jobSite('expertise').url)
  expect(page.entries).toHaveLength(2)
  expect(page.entries.map((r) => r.title)).toEqual([
    '(Senior) Actuarial Associates & Qualified Actuaries - P&C',
    '(Senior) Actuarial Associates & Qualified Actuaries - Life & Annuities',
  ])
})
it('keeps unselected discovery targets unsearched with null counts and rejects duplicated keys across pages', () => {
  const page = parseJobPage(
    'onecomm',
    bytes({ meta: { totalCount: 0 }, result: [] }),
    jobStartUrl('onecomm'),
  )
  const observation = {
    site: 'onecomm' as const,
    page,
    source: {
      sourceId: 'one',
      sourceVersion: 'a'.repeat(64),
      sourceName: 'One',
      uri: jobStartUrl('onecomm'),
      retrievedAt: '2026-10-11T22:00:00Z',
    },
  }
  const dataset = jobDataset([observation], null, ['onecomm'])
  const government = dataset.tables[1].rows.find(
    (r) => r.cells.source.value === 'Government careers',
  )!
  expect(government.cells.matched_rows.value).toBeNull()
  expect(government.cells.last_checked.value).toBeNull()
  expect(government.cells.status.value).toContain('not collected')
  const detail = parseJobPage(
    'onecomm',
    bytes({
      result: {
        jobOpening: {
          jobOpeningName: 'Data Analyst',
          jobOpeningShareUrl: 'https://onecomm.bamboohr.com/careers/124',
          jobOpeningStatus: 'Open',
          location: { city: 'Hamilton', addressCountry: 'Bermuda' },
        },
      },
    }),
    'https://onecomm.bamboohr.com/careers/124/detail',
  )
  expect(() =>
    jobDataset(
      [
        { ...observation, page: detail },
        { ...observation, page: detail },
      ],
      null,
      ['onecomm'],
    ),
  ).toThrow('Duplicate listing keys across')
})
it.skipIf(process.env.INFOMONK_WIDE_PROBE !== '1')(
  'checks independently captured primary source shapes',
  () => {
    const d = resolve('../../e2e/artifacts/jobs-wide-probe')
    for (const [id, file, uri] of [
      ['linkedin', 'linkedin.html', jobStartUrl('linkedin')],
      ['jobsinbda', 'jobsinbda-feed.txt', jobStartUrl('jobsinbda')],
      [
        'jobsinbda',
        'wp-detail.txt',
        'https://www.jobsinbda.com/job/business-intelligence-specialist-full-time/',
      ],
      ['hamilton', 'hamilton.html', jobSite('hamilton').url],
      ['ccs', 'ccs.html', jobSite('ccs').url],
      ['clarien', 'clarien.html', jobSite('clarien').url],
      ['onecomm', 'one-list-json.txt', jobStartUrl('onecomm')],
      ['onecomm', 'one-detail-json.txt', 'https://onecomm.bamboohr.com/careers/124/detail'],
      ['skyport', 'sky-list-json.txt', jobStartUrl('skyport')],
      ['artex', 'artex.txt', jobSite('artex').url],
      [
        'artex',
        'artex-detail.html',
        'https://phe.tbe.taleo.net/phe03/ats/careers/v2/viewRequisition?org=FRONTIER&cws=40&rid=222',
      ],
      ['island', 'island.html', jobSite('island').url],
      ['deloitte', 'deloitte-jobs.txt', jobSite('deloitte').url],
      ['axis', 'axis-feed-global.json', jobStartUrl('axis')],
      ['arch', 'arch-feed-global.json', jobStartUrl('arch')],
      ['hiscox', 'hiscox-feed-global.json', jobStartUrl('hiscox')],
      ['athora', 'athora-feed-global.json', jobStartUrl('athora')],
      ['everest', 'everest-feed-global.json', jobStartUrl('everest')],
      [
        'axis',
        'axis-detail.txt',
        'https://axiscapital.wd1.myworkdayjobs.com/wday/cxs/axiscapital/axiscareers/job/Bermuda/Investment-Operations-Analyst_REQ06727',
      ],
      ['chubb', 'chubb-feed.txt', jobStartUrl('chubb')],
    ] as const) {
      const page = parseJobPage(id, readFileSync(resolve(d, file)), uri)
      console.log(
        JSON.stringify({
          id,
          file,
          entries: page.entries.length,
          links: page.links.length,
          scope: page.scopeNote,
        }),
      )
    }
  },
)
