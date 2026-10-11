import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'

// Inspect the full accepted metadata embedded by the native research writer.
// Native sheet evidence is verified separately by the Electron use-case test.
const path = process.argv[2]
if (!path) throw new Error('Pass the generated Bermuda jobs XLSX path.')
const zip = await JSZip.loadAsync(await readFile(path))
const metadata = JSON.parse(await zip.file('infomonk/research.json').async('string'))
const rows = metadata.dataset.tables.find((t) => t.id === 'jobs').rows
const value = (r, k) => r.cells[k].value
const locations = rows
  .filter((r) => !['Bermuda', 'BM'].includes(value(r, 'location')))
  .map((r) => ({ title: value(r, 'title'), location: value(r, 'location') }))
const keys = rows.map((r) => value(r, 'job_key'))
const dates = rows
  .map((r) => value(r, 'closing_date'))
  .filter(Boolean)
  .sort()
const invalidDates = dates.filter(
  (d) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(d).toISOString().slice(0, 10) !== d,
)
const invalidOrder = rows.filter(
  (r) =>
    String(value(r, 'first_seen')) > String(value(r, 'last_seen')) ||
    String(value(r, 'last_seen')) > String(value(r, 'last_checked')),
)
const missingEmployer = rows.filter((r) => value(r, 'employer') === null).length
const missingClosing = rows.filter((r) => value(r, 'closing_date') === null).length
const result = {
  grain: 'Source listing, not deduplicated real-world vacancy',
  checkedAt: new Date().toISOString(),
  attribution: metadata.attribution,
  revision: metadata.revision,
  rows: rows.length,
  uniqueRowIds: new Set(rows.map((r) => r.id)).size,
  uniqueListingKeys: new Set(keys).size,
  emptyListingKeys: keys.filter((k) => !k).length,
  missingEmployer,
  missingClosing,
  missingEmployerRate: missingEmployer / rows.length,
  missingClosingRate: missingClosing / rows.length,
  locationReview: locations,
  invalidDates,
  invalidObservationOrder: invalidOrder.length,
  minClosingDate: dates[0] ?? null,
  maxClosingDate: dates.at(-1) ?? null,
  sourceCounts: Object.fromEntries(
    [...new Set(rows.map((r) => value(r, 'source_site')))].map((s) => [
      s,
      rows.filter((r) => value(r, 'source_site') === s).length,
    ]),
  ),
  savedListings: rows
    .filter((r) => value(r, 'application_status') === 'Saved')
    .map((r) => value(r, 'title')),
  notes:
    'Counts describe accepted XLSX metadata for the checked selected-source sample. Missing agency facts and uncertain locations remain explicit. Correction guards and native cell evidence are tested separately.',
}
if (
  result.emptyListingKeys ||
  result.uniqueRowIds !== rows.length ||
  result.uniqueListingKeys !== rows.length ||
  invalidDates.length ||
  invalidOrder.length ||
  !metadata.attribution.startsWith('Public career-site listings')
)
  throw new Error('Tracker quality invariant failed: ' + JSON.stringify(result))
await writeFile(
  fileURLToPath(new URL('./quality-results.json', import.meta.url)),
  JSON.stringify(result, null, 2) + '\n',
)
console.log(JSON.stringify(result, null, 2))
