import { createHash } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { jobDataset, parseJobPage } from '../src/main/research/jobs'
import {
  fetchJobPage,
  jobIsJson,
  jobSite,
  jobStartUrl,
  jobUrl,
  GOVERNMENT_PORTAL_TENANT,
} from '../src/main/research/job-routes'

const json = (value: unknown) => Buffer.from(JSON.stringify(value))
const feed = () => jobSite('government').feed!
const api = (id: number) => `https://emea3.recruitmentplatform.com/fo/rest/jobs/${id}/details`
const portal = () =>
  Buffer.from(`<title>Government of Bermuda - Careers</title>
<script data-lumesse-site-tech-id="QLQFK026203F3VBQBV7V48MQG" data-lumesse-fo-host="emea3.recruitmentplatform.com"></script>
<label>Closing time to apply for any job is 7:00pm Bermuda time (AST - Atlantic Standard Time) on the stated closing date</label>
<div id="lumesseJobsListWidget"></div>`)

// Independently authored public-list-shaped fixture: thirteen vacancies, exactly
// four office titles. General engineering, mechanic and clinical roles are excluded.
const titles = [
  [6933, 'ADMINISTRATIVE ASSISTANT'],
  [6963, 'ADMINISTRATIVE ASSISTANT - CHILD HEALTH'],
  [6935, 'CUSTOMER SERVICE REPRESENTATIVE'],
  [6959, 'DENTAL ASSISTANT / ORAL HEALTH EDUCATOR'],
  [6967, 'EDUCATION OFFICER, PHYSICAL EDUCATION & HEALTH'],
  [6957, 'ESTATES SURVEYOR'],
  [6965, 'FLEET MANAGER'],
  [6945, 'MANAGEMENT ACCOUNTANT'],
  [6972, 'MEDICAL OFFICER (POLICE & PRISONS)'],
  [6980, 'NURSING ASSOCIATE'],
  [6975, 'STRUCTURAL ENGINEER'],
  [6955, 'TECHNICIAN - MECHANIC'],
  [6961, 'TRAINEE DENTAL ASSISTANT/ORAL HEALTH EDUCATOR'],
] as const
const vacancy = (id: number, title: string, patch: Record<string, unknown> = {}) => ({
  id,
  jobFields: {
    id,
    jobTitle: title,
    jobNumber: `DHR-${id}`,
    sLovList2: 'Source Department',
    DPOSTINGEND: id === 6945 ? 1792637999000 : 1792033199000,
    POSTINGTIMEZONE: 'Atlantic/Bermuda',
    applicationUrl: 'https://emea3.recruitmentplatform.com/apply-app/pages/application-form',
    ...patch,
  },
  customFields: [
    { title: 'Summary of Accountability', content: '<p>Literal public role description.</p>' },
  ],
})
const all = () => titles.map(([id, title]) => vacancy(id, title))
const list = (rows = all().slice(0, 10), total = 13) =>
  json({ globals: { jobsCount: total, selectedSearchCriteria: [] }, jobs: rows })
const detail = (id = 6933, title = 'ADMINISTRATIVE ASSISTANT', patch = {}) =>
  json({ ...vacancy(id, title, patch), globals: { jobsCount: 1 }, hideApplyButton: false })

it('captures portal identity and its literal local closing notice before queueing the verified public list', () => {
  expect(jobStartUrl('government')).toBe('https://govtcareers.gov.bm/')
  const page = parseJobPage('government', portal(), jobStartUrl('government'))
  expect(page.links).toEqual([jobUrl('government', feed())])
  expect(page.scopeNote).toContain('7:00pm Bermuda time (AST - Atlantic Standard Time)')
  expect(page.units.some((u) => u.text === 'Government of Bermuda - Careers')).toBe(true)
  expect(() =>
    parseJobPage('government', Buffer.from('<title>Sign in</title>'), jobStartUrl('government')),
  ).toThrow('identity')
  expect(() =>
    parseJobPage(
      'government',
      Buffer.from(portal().toString().replace('7:00pm', '8:00pm')),
      jobStartUrl('government'),
    ),
  ).toThrow('closing notice')
})

it('screens all thirteen listed titles across both pages and queues exactly four scoped details', () => {
  const first = parseJobPage('government', list(), feed())
  const secondUri = first.links.find(
    (uri) => new URL(uri).searchParams.get('firstResult') === '10',
  )!
  const second = parseJobPage('government', list(all().slice(10)), secondUri)
  expect(first.advertised).toBe(10)
  expect(second.advertised).toBe(3)
  expect(first.entries).toEqual([])
  expect(second.links).toEqual([])
  expect(first.links.filter((uri) => new URL(uri).pathname.endsWith('/details'))).toEqual([
    api(6933),
    api(6963),
    api(6935),
    api(6945),
  ])
  expect(first.scopeNote).toContain('13 vacancies')
  expect(first.units.filter((u) => u.locator.startsWith('JSON /jobs/'))).toHaveLength(10)
  expect(second.units.filter((u) => u.locator.startsWith('JSON /jobs/'))).toHaveLength(3)
})

it('preserves absent facts, raw deadline timezone and immutable detail evidence without following application URLs', () => {
  const bytes = detail(6963, 'ADMINISTRATIVE ASSISTANT - CHILD HEALTH', {
    DPOSTINGEND: 1792015199000,
    POSTINGTIMEZONE: 'Europe/Paris',
  })
  const page = parseJobPage('government', bytes, api(6963))
  const row = page.entries[0]
  expect(row).toMatchObject({
    key: 'government:6963',
    employer: null,
    location: null,
    posted_date: null,
    closing_date: '2026-10-14',
  })
  expect(row.listing_url).toBe(
    'https://govtcareers.gov.bm/details.html?jobId=6963&jobTitle=ADMINISTRATIVE+ASSISTANT+-+CHILD+HEALTH',
  )
  expect(page.links).toEqual([])
  expect(row.issues.join(' ')).toContain('Europe/Paris')
  expect(row.issues.join(' ')).toContain('7:00pm Bermuda time (AST - Atlantic Standard Time)')
  expect(row.issues.join(' ')).toContain('not a verified application cutoff')
  expect(row.proof.employer).toBeUndefined()
  expect(row.proof.closing_date.locator).toBe('JSON /jobFields')
  expect(JSON.parse(row.proof.closing_date.text).DPOSTINGEND).toBe(1792015199000)
  for (const proof of Object.values(row.proof))
    expect(
      page.units.some((unit) => unit.locator === proof.locator && unit.text === proof.text),
    ).toBe(true)
  const dataset = jobDataset(
    [
      {
        site: 'government',
        page,
        source: {
          sourceId: 'public-government-detail',
          sourceVersion: createHash('sha256').update(bytes).digest('hex'),
          sourceName: 'Public government vacancy',
          uri: api(6963),
          retrievedAt: '2026-10-12T12:00:00Z',
        },
      },
    ],
    null,
    ['government'],
  )
  const cells = dataset.tables[0].rows[0].cells
  expect(cells.location.value).toBeNull()
  expect(cells.location.issues.join(' ')).toContain('Confirm')
  expect(cells.scope_reason.value).toContain('Europe/Paris')
  expect(cells.closing_date.evidence[0].sourceVersion).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  )
})

it('uses the literal source calendar date rather than the UTC date or a guessed Bermuda conversion', () => {
  const atlantic = parseJobPage('government', detail(), api(6933)).entries[0]
  expect(new Date(1792033199000).toISOString().slice(0, 10)).toBe('2026-10-15')
  expect(atlantic.closing_date).toBe('2026-10-14')
  const accountant = parseJobPage('government', detail(6945, 'MANAGEMENT ACCOUNTANT'), api(6945))
    .entries[0]
  expect(accountant.closing_date).toBe('2026-10-21')
  const missing = parseJobPage(
    'government',
    detail(6933, 'ADMINISTRATIVE ASSISTANT', { DPOSTINGEND: null }),
    api(6933),
  ).entries[0]
  expect(missing.closing_date).toBeNull()
  expect(missing.proof.closing_date).toBeUndefined()
})

it('bounds pagination and rejects identity/count/description/timezone changes before accepting incomplete facts', () => {
  expect(() => parseJobPage('government', list(all().slice(0, 9)), feed())).toThrow('pagination')
  expect(() => parseJobPage('government', list([], 301), feed())).toThrow('bounds')
  const duplicate = all().slice(0, 10)
  duplicate[1] = duplicate[0]
  expect(() => parseJobPage('government', list(duplicate), feed())).toThrow('Duplicate')
  expect(() => parseJobPage('government', detail(), api(6963))).toThrow('identity')
  expect(() =>
    parseJobPage(
      'government',
      detail(6933, 'ADMINISTRATIVE ASSISTANT', { POSTINGTIMEZONE: 'UTC' }),
      api(6933),
    ),
  ).toThrow('timezone')
  expect(() =>
    parseJobPage(
      'government',
      detail(6933, 'ADMINISTRATIVE ASSISTANT', { DPOSTINGEND: '2026-10-14' }),
      api(6933),
    ),
  ).toThrow('timestamp')
  expect(() =>
    parseJobPage(
      'government',
      json({
        ...vacancy(6933, 'ADMINISTRATIVE ASSISTANT'),
        customFields: [{ title: 'Summary', content: 'x'.repeat(100001) }],
        globals: { jobsCount: 1 },
      }),
      api(6933),
    ),
  ).toThrow('description')
  expect(parseJobPage('government', list([], 0), feed()).advertised).toBe(0)
})

it('allows only the government portal and the two fixed read-only vacancy endpoint shapes', () => {
  expect(jobIsJson('government', feed())).toBe(true)
  expect(jobIsJson('government', api(6933))).toBe(true)
  expect(jobIsJson('government', jobStartUrl('government'))).toBe(false)
  for (const uri of [
    'https://emea3.recruitmentplatform.com/fo/rest/authentication/login',
    'https://emea3.recruitmentplatform.com/fo/rest/config',
    'https://emea3.recruitmentplatform.com/apply-app/pages/application-form',
    'https://emea3.recruitmentplatform.com/fo/rest/jobs/6933/application',
    api(6933) + '?sourceBoard=other',
    feed() + '&username=other',
    feed() + '&firstResult=10',
    feed().replace('firstResult=0', 'firstResult=1'),
    feed().replace('firstResult=0', 'firstResult=300'),
    feed().replace('maxResults=10', 'maxResults=1000'),
    feed().replace('sortBy=jobTitle', 'sortBy=id'),
    feed().replace('sortOrder=asc', 'sortOrder=desc'),
    'https://govtcareers.gov.bm/details.html?jobId=6933&jobTitle=Role&apply=true',
    'https://govtcareers.gov.bm/details.html?jobId=6933',
    'https://other.example/fo/rest/jobs/6933/details',
  ])
    expect(() => jobUrl('government', uri)).toThrow()
})

it('uses only published guest selectors for API requests, fixed list POST body, and no credentials on portal requests', async () => {
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (uri) =>
      new Response(String(uri).includes('/fo/rest/') ? list() : portal(), {
        headers: {
          'content-type': String(uri).includes('/fo/rest/') ? 'application/json' : 'text/html',
        },
      }),
  )
  try {
    const signal = new AbortController().signal
    await fetchJobPage('government', jobStartUrl('government'), signal)
    await fetchJobPage('government', feed(), signal)
    await fetchJobPage('government', api(6933), signal)
    const portalRequest = spy.mock.calls[0][1]!
    expect(portalRequest).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error' })
    expect(portalRequest.headers).not.toHaveProperty('username')
    const listRequest = spy.mock.calls[1][1]!
    expect(listRequest).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' })
    expect(listRequest.headers).toMatchObject({
      'lumesse-language': 'EN',
      username: `${GOVERNMENT_PORTAL_TENANT}:guest:FO`,
      password: 'guest',
    })
    expect(JSON.parse(String(listRequest.body))).toEqual({ searchCriteria: { criteria: [] } })
    expect(spy.mock.calls[2][1]).toMatchObject({ method: 'GET', credentials: 'omit' })
    expect(spy.mock.calls[2][1]!.body).toBeUndefined()
    await expect(
      fetchJobPage(
        'government',
        'https://emea3.recruitmentplatform.com/fo/rest/authentication/login',
        signal,
      ),
    ).rejects.toThrow()
    expect(spy).toHaveBeenCalledTimes(3)
  } finally {
    spy.mockRestore()
  }
})

it('gates Workday and Oracle employer evidence on a literal nonempty reported employer, and preserves both availability flags', () => {
  const workdayUri =
    'https://axiscapital.wd1.myworkdayjobs.com/wday/cxs/axiscapital/axiscareers/job/Bermuda/Data-Analyst_REQ123'
  for (const organization of [null, { name: '' }, { name: '   ' }]) {
    const page = parseJobPage(
      'axis',
      json({
        hiringOrganization: organization,
        jobPostingInfo: {
          title: 'Data Analyst',
          jobReqId: 'REQ123',
          country: { descriptor: 'Bermuda' },
          location: 'Hamilton',
          externalUrl:
            'https://axiscapital.wd1.myworkdayjobs.com/axiscareers/job/Bermuda/Data-Analyst_REQ123',
          posted: false,
          canApply: true,
        },
      }),
      workdayUri,
    )
    expect(page.entries[0].proof.employer).toBeUndefined()
    expect(page.entries[0].employer).toBe('AXIS')
    expect(JSON.parse(page.entries[0].proof.listing_status.text)).toMatchObject({
      posted: false,
      canApply: true,
    })
  }
  const oracle = parseJobPage(
    'chubb',
    json({
      items: [
        {
          TotalJobsCount: 1,
          Offset: 0,
          requisitionList: [
            { Id: '123', Title: 'Data Analyst', PrimaryLocation: 'Bermuda', LegalEmployer: null },
          ],
        },
      ],
    }),
    jobStartUrl('chubb'),
  )
  expect(oracle.entries[0].employer).toBe('Chubb')
  expect(oracle.entries[0].proof.employer).toBeUndefined()
})

it('retains BambooHR operational descriptions as exact review evidence without claiming office fit', () => {
  const description =
    '<p>This hybrid role supervises field personnel and warehouse, inventory control and/or logistics.</p>'
  const page = parseJobPage(
    'performance',
    json({
      result: {
        jobOpening: {
          jobOpeningName: 'TEAM LEAD - OPERATIONS',
          jobOpeningStatus: 'Open',
          jobOpeningShareUrl: 'https://performancesolutions.bamboohr.com/careers/179',
          location: { city: 'Hamilton', addressCountry: 'Bermuda' },
          description,
        },
      },
    }),
    'https://performancesolutions.bamboohr.com/careers/179/detail',
  )
  expect(page.entries[0].issues.join(' ')).toContain('warehouse/logistics')
  expect(page.entries[0].proof.scope_reason.locator).toBe('JSON /result/jobOpening/description')
  expect(JSON.parse(page.entries[0].proof.scope_reason.text)).toBe(description)
})

it.skipIf(process.env.INFOMONK_GOVERNMENT_LIVE !== '1')(
  'acquires the actual identified public portal, all thirteen records and four role details with immutable proof coverage',
  async () => {
    const pending = [jobStartUrl('government')],
      seen = new Set<string>()
    const pages: ReturnType<typeof parseJobPage>[] = []
    const versions: { uri: string; bytes: number; sha256: string }[] = []
    while (pending.length) {
      const uri = jobUrl('government', pending.shift()!)
      if (seen.has(uri)) continue
      const bytes = await fetchJobPage('government', uri, new AbortController().signal)
      const page = parseJobPage('government', bytes, uri)
      pages.push(page)
      seen.add(uri)
      versions.push({
        uri,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
      pending.push(...page.links)
      for (const row of page.entries)
        for (const proof of Object.values(row.proof))
          expect(page.units.some((u) => u.locator === proof.locator && u.text === proof.text)).toBe(
            true,
          )
    }
    expect(pages.reduce((sum, page) => sum + (page.advertised ?? 0), 0)).toBe(13)
    const entries = pages.flatMap((page) => page.entries)
    expect(entries.map((row) => row.key).sort()).toEqual([
      'government:6933',
      'government:6935',
      'government:6945',
      'government:6963',
    ])
    expect(entries.map((row) => row.closing_date).sort()).toEqual([
      '2026-10-14',
      '2026-10-14',
      '2026-10-14',
      '2026-10-21',
    ])
    expect(seen.size).toBe(7)
    console.log(
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        advertised: 13,
        captured: entries.length,
        pages: versions,
        records: entries.map(({ key, title, closing_date }) => ({ key, title, closing_date })),
      }),
    )
  },
  120000,
)
