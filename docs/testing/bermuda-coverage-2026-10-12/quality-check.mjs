import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

const workbook = process.argv[2]
if (!workbook) throw Error('Pass the generated coverage workbook path.')
const zip = await JSZip.loadAsync(await readFile(workbook))
const metadata = JSON.parse(await zip.file('infomonk/research.json').async('string'))
const table = (id) => metadata.dataset.tables.find((t) => t.id === id)
const rows = table('jobs').rows
const sources = table('job_sources').rows
const v = (r, key) => r.cells[key]?.value ?? null
const current = rows.filter(
  (r) => !/^(Not found|Outside selected)/i.test(String(v(r, 'listing_status'))),
)
const keys = rows.map((r) => v(r, 'job_key'))
const invalidDates = rows.flatMap((r) =>
  ['posted_date', 'closing_date', 'advert_expiry'].flatMap((key) => {
    const date = v(r, key)
    if (date === null) return []
    return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !Number.isNaN(Date.parse(date)) &&
      new Date(date).toISOString().slice(0, 10) === date
      ? []
      : [{ key: v(r, 'job_key'), field: key, value: date }]
  }),
)
const invalidObservationOrder = rows.filter(
  (r) =>
    String(v(r, 'first_seen')) > String(v(r, 'last_seen')) ||
    String(v(r, 'last_seen')) > String(v(r, 'last_checked')),
)
const invalidEvidence = rows.flatMap((r) =>
  Object.entries(r.cells).flatMap(([key, c]) =>
    c.evidence
      .filter(
        (e) => !/^[a-f\d]{64}$/.test(e.sourceVersion) || !e.locator || !e.uri || !e.retrievedAt,
      )
      .map(() => ({ key: v(r, 'job_key'), field: key })),
  ),
)
const falseEmployerProof = rows.filter(
  (r) =>
    v(r, 'employer') !== null &&
    r.cells.employer.origin === 'external' &&
    r.cells.employer.evidence.some((e) => /datePosted|startDate|PostingEndDate/.test(e.locator)),
)
const notCollected = sources.filter((r) => v(r, 'last_checked') === null)
const currentSources = sources.filter(
  (r) => v(r, 'last_checked') !== null && !/^Outside selected/i.test(String(v(r, 'status'))),
)
const invalidUncollectedCounts = notCollected.filter((r) => v(r, 'matched_rows') !== null)
const sourceMatchTotal = currentSources.reduce(
  (sum, r) => sum + Number(v(r, 'matched_rows') ?? 0),
  0,
)
const result = {
  checkedAt: new Date().toISOString(),
  workbook,
  grain: 'One source listing per source key; cross-site postings may describe the same vacancy.',
  revision: metadata.revision,
  acceptedSourceListings: rows.length,
  currentObservedSourceListings: current.length,
  retainedAbsentOrUnselectedListings: rows.length - current.length,
  uniqueRecordIds: new Set(rows.map((r) => r.id)).size,
  uniqueListingKeys: new Set(keys).size,
  sourceTargets: sources.length,
  acquiredSourceChecks: currentSources.length,
  retainedHistoricalSourceChecks: sources.length - notCollected.length - currentSources.length,
  uncollectedTrackerTargets: notCollected.map((r) => v(r, 'source')),
  sourceMatchTotal,
  sourceCounts: Object.fromEntries(
    [...new Set(current.map((r) => v(r, 'source_site')))].map((s) => [
      s,
      current.filter((r) => v(r, 'source_site') === s).length,
    ]),
  ),
  missingEmployer: rows.filter((r) => v(r, 'employer') === null).length,
  configuredPublisherEmployerNames: rows.filter(
    (r) => v(r, 'employer') !== null && r.cells.employer.origin === 'internal',
  ).length,
  missingClosingDate: rows.filter((r) => v(r, 'closing_date') === null).length,
  explicitEmployerDeadlines: rows.filter((r) => v(r, 'closing_date') !== null).length,
  publicationExpiries: rows.filter((r) => v(r, 'advert_expiry') !== null).length,
  locationReview: rows
    .filter((r) => r.cells.location.issues.length)
    .map((r) => ({
      key: v(r, 'job_key'),
      title: v(r, 'title'),
      location: v(r, 'location'),
      issues: r.cells.location.issues,
    })),
  domainReview: rows
    .filter(
      (r) =>
        /review|adjacent/i.test(String(v(r, 'role_group'))) ||
        /warehouse|logistics|physical operational/i.test(String(v(r, 'scope_reason'))),
    )
    .map((r) => ({
      key: v(r, 'job_key'),
      title: v(r, 'title'),
      roleGroup: v(r, 'role_group'),
      reason: v(r, 'scope_reason'),
    })),
  savedListings: rows
    .filter((r) => v(r, 'application_status') === 'Saved')
    .map((r) => ({ key: v(r, 'job_key'), title: v(r, 'title'), notes: v(r, 'notes') })),
  sourceChecks: sources.map((r) =>
    Object.fromEntries(Object.entries(r.cells).map(([key, c]) => [key, c.value])),
  ),
  invalidDates,
  invalidObservationOrder: invalidObservationOrder.length,
  invalidEvidence,
  falseEmployerProof: falseEmployerProof.length,
  invalidUncollectedCounts: invalidUncollectedCounts.length,
  limits: [
    'Listed at check is not guaranteed still accepting applications.',
    'Adapter completion covers its declared bounded query, not all possible jobs.',
    'Manual browser discoveries are separate evidence and are not silently inserted into this automatic tracker.',
    'No personal suitability, salary estimate or permit eligibility is inferred.',
  ],
}
if (
  new Set(keys).size !== rows.length ||
  new Set(rows.map((r) => r.id)).size !== rows.length ||
  keys.some((k) => !k) ||
  sourceMatchTotal !== current.length ||
  invalidDates.length ||
  invalidObservationOrder.length ||
  invalidEvidence.length ||
  falseEmployerProof.length ||
  invalidUncollectedCounts.length ||
  !result.savedListings.length
)
  throw Error('Quality invariant failed: ' + JSON.stringify(result))
await writeFile(
  fileURLToPath(new URL('./quality-results.json', import.meta.url)),
  JSON.stringify(result, null, 2) + '\n',
)
console.log(
  JSON.stringify(
    {
      revision: result.revision,
      rows: rows.length,
      currentRows: current.length,
      sourceChecks: result.acquiredSourceChecks,
      targets: result.sourceTargets,
      missingEmployer: result.missingEmployer,
      configuredPublisherEmployerNames: result.configuredPublisherEmployerNames,
      missingClosingDate: result.missingClosingDate,
      qualityInvariant: 'passed',
    },
    null,
    2,
  ),
)
