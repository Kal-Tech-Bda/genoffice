import { it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  jobSite,
  jobStartUrl,
  jobUrl,
  fetchJobPage,
  parseJobPage,
  jobDataset,
} from '../src/main/research/jobs'
import type { JobObservation } from '../src/main/research/jobs'
import { hash } from '../src/main/research/extract'
import { jobScope } from '../src/main/research/job-scope'

const sites = ['apex', 'sompo', 'ariel', 'performance'] as const
it('includes observed HR and corporate office title misses without admitting clinical or trade work', () => {
  for (const title of [
    'Director Learning & Talent Development',
    'Country Head, Bermuda',
    'Payroll Specialist',
    'Procurement Officer',
    'HR Advisor',
    'Trust Officer',
    'Senior Corporate Manager',
    'Treasury Specialist',
    'Customer Service Representative',
  ])
    expect(jobScope(title)).toBe('Office / finance')
  for (const title of [
    'Head Chef',
    'Clinical Pharmacist',
    'Electrician',
    'Registered Nurse',
    'Learning Support Teacher',
  ])
    expect(jobScope(title)).toBeNull()
  expect(jobScope('CUSTOMER SERVICE & WAREHOUSE OPERATIONS')).toBe(
    'Mixed operational role — domain review',
  )
  expect(jobScope('Warehouse Loader')).toBeNull()
})
it('reuses public adapters without permitting cross-employer or application routes', () => {
  for (const id of sites) {
    expect(jobUrl(id, jobStartUrl(id))).toBe(jobStartUrl(id))
    expect(() => jobUrl(id, 'https://example.org/careers')).toThrow()
    expect(() => jobUrl(id, '/login')).toThrow()
    expect(() => jobUrl(id, '/careers/1/apply')).toThrow()
  }
})

it('does not cite a posting date as proof of a configured employer name', () => {
  const uri = 'https://arielre.bamboohr.com/careers/161/detail'
  const bytes = Buffer.from(
    JSON.stringify({
      result: {
        jobOpening: {
          jobOpeningName: 'Enterprise Governance and Compliance Analyst',
          location: { city: 'Hamilton', addressCountry: 'Bermuda' },
          jobOpeningShareUrl: 'https://arielre.bamboohr.com/careers/161',
          datePosted: '2026-10-09',
          jobOpeningStatus: 'Open',
        },
      },
    }),
  )
  const page = parseJobPage('ariel', bytes, uri)
  const row = jobDataset(
    [
      {
        site: 'ariel',
        page,
        source: {
          sourceId: hash(uri),
          sourceVersion: hash(bytes),
          uri,
          sourceName: 'Ariel Re',
          retrievedAt: '2026-10-12T04:00:00Z',
        },
      },
    ],
    null,
    ['ariel'],
  ).tables[0].rows[0]
  expect(row.cells.employer.value).toBe('Ariel Re')
  expect(row.cells.employer.origin).toBe('internal')
  expect(row.cells.employer.evidence).toEqual([])
  expect(row.cells.employer.issues).toContain(
    'Configured publisher identity; not stated in the captured listing.',
  )
  expect(row.cells.posted_date.origin).toBe('external')
  expect(row.cells.posted_date.evidence[0].locator).toContain('/result/jobOpening/datePosted')
})

it.skipIf(process.env.INFOMONK_EMPLOYER_PROBE !== '1')(
  'LIVE checks entire bounded employer scopes and preserves exact snapshots',
  async () => {
    const dir = resolve('../../e2e/artifacts/employer-expansion-2026-10-12')
    mkdirSync(dir, { recursive: true })
    const observations: JobObservation[] = []
    const checks: unknown[] = []
    for (const site of sites) {
      const pending = [jobStartUrl(site)],
        seen = new Set<string>()
      const start = observations.length
      while (pending.length) {
        const uri = jobUrl(site, pending.shift()!)
        if (seen.has(uri)) continue
        if (seen.size >= 900) throw Error('Page bound exceeded')
        const bytes = await fetchJobPage(site, uri, AbortSignal.timeout(20_000))
        const sourceVersion = hash(bytes),
          page = parseJobPage(site, bytes, uri)
        writeFileSync(resolve(dir, `${site}-${seen.size}-${sourceVersion}.json`), bytes)
        observations.push({
          site,
          page,
          source: {
            sourceId: hash(uri),
            sourceVersion,
            uri,
            sourceName: jobSite(site).name,
            retrievedAt: new Date().toISOString(),
          },
        })
        seen.add(uri)
        for (const link of page.links)
          if (!seen.has(link) && !pending.includes(link)) pending.push(link)
      }
      checks.push({
        site,
        pages: seen.size,
        matching: observations.slice(start).flatMap((x) => x.page.entries).length,
        scope: observations
          .slice(start)
          .map((x) => x.page.scopeNote)
          .filter(Boolean),
      })
    }
    const dataset = jobDataset(observations, null, [...sites])
    const records = dataset.tables[0].rows.map((row) =>
      Object.fromEntries(Object.entries(row.cells).map(([k, c]) => [k, c.value])),
    )
    expect(new Set(records.map((r) => r.job_key)).size).toBe(records.length)
    expect(records.every((r) => /bermuda/i.test(String(r.location)))).toBe(true)
    writeFileSync(
      resolve(dir, 'results.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          checks,
          records,
          inputManifest: observations.map((x) => ({
            ...x.source,
            method: x.page.method,
            entries: x.page.entries.length,
          })),
        },
        null,
        2,
      ) + '\n',
    )
  },
  180_000,
)
