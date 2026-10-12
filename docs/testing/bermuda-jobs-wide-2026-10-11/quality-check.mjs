import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const directory = dirname(fileURLToPath(import.meta.url))
const live = JSON.parse(readFileSync(resolve(directory, 'live-results.json'), 'utf8'))
const zip = await JSZip.loadAsync(readFileSync(live.output))
const metadata = JSON.parse(await zip.file('infomonk/research.json').async('string'))
const jobs = metadata.dataset.tables.find((t) => t.id === 'jobs')
const sources = metadata.dataset.tables.find((t) => t.id === 'job_sources')
const values = (table) =>
  table.rows.map((r) => Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, c.value])))
const records = values(jobs),
  checks = values(sources)
assert.equal(metadata.revision, live.acceptedRevision)
assert.equal(
  records.length,
  live.records.length,
  'The evidence manifest must include every table page',
)
assert.equal(new Set(records.map((r) => r.job_key)).size, records.length)
assert.equal(checks.filter((r) => r.last_checked !== null).length, 19)
assert.equal(checks.filter((r) => r.last_checked === null).length, 24)
assert(checks.filter((r) => r.last_checked === null).every((r) => r.matched_rows === null))
assert.equal(
  checks.reduce((sum, r) => sum + (r.matched_rows ?? 0), 0),
  records.length,
)
assert.equal(checks.length, 43)
assert(checks.find((r) => r.source.startsWith('LinkedIn')).status.includes('PARTIAL'))
assert(
  checks
    .filter((r) => ['Arch Capital', 'Hiscox'].includes(r.source))
    .every((r) => r.status.includes('did not expose a Bermuda')),
)
assert(
  records
    .filter((r) => r.source_site.startsWith('LinkedIn'))
    .every((r) => r.employer === null && r.advertiser),
)
assert(
  records
    .filter((r) => r.source_site.startsWith('JobsInBDA'))
    .every((r) => r.closing_date === null),
)
assert.equal(
  records.find((r) => r.title === 'Intermediate Infrastructure Engineer').closing_date,
  '2026-10-09',
)
assert.equal(
  records.find((r) => r.title === 'Intermediate Infrastructure Engineer').deadline_status,
  'Past deadline',
)
const saved = records.find((r) => r.title === 'BUSINESS INTELLIGENCE SPECIALIST (Full-Time)')
assert.equal(saved.application_status, 'Saved')
assert(saved.notes.includes('Read the image advertisement'))
if (live.manualDeadlineReview) {
  assert.equal(metadata.revision, 5)
  assert(saved.notes.includes('20 October') && saved.notes.includes('21 October'))
  assert.equal(saved.closing_date, null)
}
assert(saved.first_seen < saved.last_seen)
assert(records.every((r) => r.first_seen <= r.last_seen && r.last_seen <= r.last_checked))
assert(jobs.rows.every((r) => r.cells.title.evidence.length > 0))
const countBy = (key) =>
  Object.fromEntries(
    [...new Set(records.map((r) => r[key]))].map((v) => [
      v,
      records.filter((r) => r[key] === v).length,
    ]),
  )
const result = {
  checkedAt: new Date().toISOString(),
  passed: true,
  grain: 'Source listing, not distinct confirmed vacancy',
  sourceListings: records.length,
  uniqueSourceKeys: new Set(records.map((r) => r.job_key)).size,
  currentCoverageTargets: checks.length,
  configuredPublicChecks: 19,
  uncollectedTargets: 24,
  groups: countBy('role_group'),
  bySource: countBy('source_site'),
  missingEmployer: records.filter((r) => r.employer === null).length,
  missingEmployerDeadline: records.filter((r) => r.closing_date === null).length,
  publicationExpiryKnown: records.filter((r) => r.advert_expiry !== null).length,
  pastEmployerDeadline: records.filter((r) => r.deadline_status === 'Past deadline').length,
  talentPoolObservations: records.filter((r) => r.listing_status.startsWith('Talent pool')).length,
  locationReview: jobs.rows.filter((r) => r.cells.location.issues.length > 0).length,
  distinctCurrentVacancies: null,
  limitation:
    'No reliable market denominator or cross-site employer reconciliation. Partial guest and keyword search boundaries remain explicit.',
}
writeFileSync(resolve(directory, 'quality-results.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
