import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { fetchJobPage, jobIsJson, jobStartUrl, jobUrl } from '../src/main/research/job-routes'
import { jobDataset, parseJobPage } from '../src/main/research/jobs'

const job = (patch: Record<string, unknown> = {}) => ({
  id: 4971299101,
  internal_job_id: 12345,
  title: 'VP, Catastrophe Modeler',
  location: { name: 'New York City' },
  offices: [{ name: 'Bermuda', location: 'Hamilton, Hamilton, Bermuda' }],
  absolute_url: 'https://job-boards.eu.greenhouse.io/siriuspoint/jobs/4971299101',
  company_name: 'SiriusPoint',
  updated_at: '2026-10-11T14:00:00Z',
  first_published: '2026-09-28T14:00:00Z',
  application_deadline: null,
  content: 'Bermuda-headquartered company with US and UK operations.',
  ...patch,
})
const response = (jobs: unknown[], meta: Record<string, unknown> = { total: jobs.length }) =>
  Buffer.from(JSON.stringify({ jobs, meta }))

it('keeps the exact verified Greenhouse public board/feed routes and excludes application/auth/other-board routes', () => {
  for (const id of ['sirius', 'fortitude'] as const) {
    expect(jobUrl(id, jobStartUrl(id))).toBe(jobStartUrl(id))
    expect(jobIsJson(id, jobStartUrl(id))).toBe(true)
  }
  expect(jobUrl('sirius', job().absolute_url)).toBe(job().absolute_url)
  const fortitude =
    'https://app.careerpuck.com/job-board/fortitudegroupholdingsllc/job/5236142007?gh_jid=5236142007'
  expect(jobUrl('fortitude', fortitude)).toBe(fortitude)
  for (const [id, uri] of [
    ['sirius', 'https://boards-api.greenhouse.io/v1/boards/other/jobs?content=true'],
    ['sirius', jobStartUrl('sirius') + '&questions=true'],
    ['sirius', jobStartUrl('sirius') + '&content=false'],
    ['sirius', jobStartUrl('sirius').replace('content=true', 'content=false')],
    ['sirius', 'https://boards-api.greenhouse.io/v1/boards/siriuspoint/jobs/4971299101'],
    ['sirius', job().absolute_url + '/apply'],
    ['sirius', job().absolute_url + '?questions=true'],
    ['sirius', 'https://job-boards.eu.greenhouse.io/siriuspoint/job/4971299101'],
    ['fortitude', fortitude.replace('5236142007?gh_jid=5236142007', '5236142007?gh_jid=1')],
    ['fortitude', fortitude.replace('/job/', '/jobs/')],
    ['fortitude', 'https://app.careerpuck.com/login'],
    ['fortitude', 'https://app.careerpuck.com/job-board/other/job/5236142007'],
  ] as const)
    expect(() => jobUrl(id, uri)).toThrow()
})

it('retains the literal non-Bermuda headline and explicit Bermuda-office conflict as a location-review lead', () => {
  const bytes = response([job()])
  const page = parseJobPage('sirius', bytes, jobStartUrl('sirius'))
  expect(page.advertised).toBe(1)
  expect(page.links).toEqual([])
  expect(page.entries[0]).toMatchObject({
    key: 'sirius:4971299101',
    location: 'New York City',
    employer: 'SiriusPoint',
    posted_date: '2026-09-28',
    closing_date: null,
    observation: 'Listed with conflicting location fields — review; Bermuda option unconfirmed',
  })
  expect(page.entries[0].issues.join(' ')).toContain('Hamilton, Hamilton, Bermuda')
  const proof = page.entries[0].proof.location
  expect(proof.locator).toBe('JSON /jobs/0')
  expect(JSON.parse(proof.text).location.name).toBe('New York City')
  expect(
    page.units.some((unit) => unit.locator === proof.locator && unit.text === proof.text),
  ).toBe(true)
  const dataset = jobDataset(
    [
      {
        site: 'sirius',
        page,
        source: {
          sourceId: 'sirius-feed',
          sourceVersion: createHash('sha256').update(bytes).digest('hex'),
          sourceName: 'SiriusPoint public board',
          uri: jobStartUrl('sirius'),
          retrievedAt: '2026-10-12T03:00:00Z',
        },
      },
    ],
    null,
    ['sirius'],
  )
  expect(dataset.tables[0].rows[0].cells.location.value).toBe('New York City')
  expect(dataset.tables[0].rows[0].cells.location.issues.join(' ')).toContain('Confirm')
  expect(dataset.tables[0].rows[0].cells.scope_reason.value).toContain('conflicting')
})

it('does not infer Bermuda from corporate descriptions, generic remote roles, or an updated timestamp', () => {
  const excluded = parseJobPage(
    'sirius',
    response([
      job({ location: { name: 'Remote' }, offices: [{ name: 'United States', location: null }] }),
    ]),
    jobStartUrl('sirius'),
  )
  expect(excluded.entries).toEqual([])
  expect(excluded.advertised).toBe(1)
  expect(excluded.scopeNote).toContain('not a market-wide zero-job claim')
  const included = parseJobPage(
    'sirius',
    response([job({ location: { name: 'Bermuda' }, first_published: null })]),
    jobStartUrl('sirius'),
  )
  expect(included.entries[0].posted_date).toBeNull()
  expect(included.entries[0].proof.posted_date).toBeUndefined()
  expect(included.entries[0].closing_date).toBeNull()
})

it('uses literal publication/deadline/employer fields with exact evidence, never the registry employer as a guessed fact', () => {
  const page = parseJobPage(
    'sirius',
    response([
      job({
        location: { name: 'Bermuda' },
        company_name: null,
        application_deadline: '2026-11-10',
      }),
    ]),
    jobStartUrl('sirius'),
  )
  expect(page.entries[0].employer).toBeNull()
  expect(page.entries[0].closing_date).toBe('2026-11-10')
  expect(page.entries[0].proof.closing_date).toEqual({
    locator: 'JSON /jobs/0/application_deadline',
    text: '"2026-11-10"',
  })
  expect(() =>
    parseJobPage(
      'sirius',
      response([job({ application_deadline: { date: '2026-11-10' } })]),
      jobStartUrl('sirius'),
    ),
  ).toThrow('deadline shape')
})

it.each([
  ['missing records', [job()], { total: 2 }, 'coverage is incomplete'],
  ['unexpected pagination', [job()], { total: 1, next_page: 2 }, 'paginated'],
  ['duplicate post IDs', [job(), job()], { total: 2 }, 'Duplicate'],
  ['missing location', [job({ location: {} })], { total: 1 }, 'location'],
  ['missing office shape', [job({ offices: null })], { total: 1 }, 'array'],
  [
    'wrong ID link',
    [job({ absolute_url: 'https://job-boards.eu.greenhouse.io/siriuspoint/jobs/1' })],
    { total: 1 },
    'post ID',
  ],
] as const)('rejects %s before claiming full-board coverage', (_name, jobs, meta, message) => {
  expect(() => parseJobPage('sirius', response([...jobs], meta), jobStartUrl('sirius'))).toThrow(
    message,
  )
})

it('acquires the whole verified feed with one credential-free GET and no role/application calls', async () => {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(response([]), { headers: { 'content-type': 'application/json' } }),
    )
  try {
    const bytes = await fetchJobPage(
      'fortitude',
      jobStartUrl('fortitude'),
      new AbortController().signal,
    )
    expect(JSON.parse(bytes.toString()).meta.total).toBe(0)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
    })
    expect(spy.mock.calls[0][1]?.body).toBeUndefined()
  } finally {
    spy.mockRestore()
  }
})

it.skipIf(process.env.INFOMONK_GREENHOUSE_LIVE !== '1')(
  'checks both actual primary public feeds and exact response/evidence coverage',
  async () => {
    for (const id of ['sirius', 'fortitude'] as const) {
      const uri = jobStartUrl(id),
        bytes = await fetchJobPage(id, uri, new AbortController().signal)
      const raw = JSON.parse(bytes.toString()),
        page = parseJobPage(id, bytes, uri)
      expect(page.advertised).toBe(raw.meta.total)
      expect(raw.jobs).toHaveLength(raw.meta.total)
      expect(page.links).toEqual([])
      for (const row of page.entries)
        for (const proof of Object.values(row.proof))
          expect(
            page.units.some((unit) => unit.locator === proof.locator && unit.text === proof.text),
          ).toBe(true)
      console.log(
        JSON.stringify({
          id,
          uri,
          checkedAt: new Date().toISOString(),
          bytes: bytes.length,
          sourceVersion: createHash('sha256').update(bytes).digest('hex'),
          advertised: page.advertised,
          collected: page.entries.length,
          locations: page.entries.map((row) => ({
            key: row.key,
            title: row.title,
            location: row.location,
            observation: row.observation,
          })),
          scope: page.scopeNote,
        }),
      )
    }
  },
  60000,
)
