# Whole-table acquisition: current audit and next use case

Audit baseline: `bd316fe341a9078c3e9ae84bb339d7ae4624f27f`. This is a code and
read-only source audit, not a new Electron runtime result. The generated data
engineering harness remains last and disabled.

## User and outcome

Maya handles office operations for a small Bermuda company. She needs to copy an
official public table into a workbook, retain its context, add her own notes and
refresh it without repeating a chat conversation or losing those notes. She
should choose the table and its identifying column; she should not need to write
JavaScript or know a DOM selector.

The next useful test is **official Bermuda holiday tables → a maintained sheet**.
It is a genuine local office task, and exposes a problem hidden by simple demos:
the year and the important observed-day notes are outside the tables. A copied
table alone does not provide a complete operational calendar.

## Capabilities at the audit baseline

| Capability                                  | Source evidence                                                                  | Present limit                                                                                                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deterministic public JSON acquisition       | `apps/shell/src/main/research/worldbank.ts`, `service.ts`                        | One fixed population indicator; up to ten countries/three years/30 observations. Full page totals and duplicate keys are checked.                                                                                             |
| Complete bounded job-source traversal       | `research/job-routes.ts`, `job-adapters.ts`, `jobs.ts`, `service.ts`             | Site-specific adapters, fixed public URL routes and measured scope. Partial public responses remain partial; this is not arbitrary table ingestion.                                                                           |
| Parsed HTML and exact structural locators   | `packages/electron-utils/src/public-html.ts`                                     | Existing parse5 dependency; 2 MiB, 50,000 nodes, depth 200. It parses static bytes and does not run scripts.                                                                                                                  |
| Saved original sources                      | `apps/shell/src/main/workspace-store.ts`                                         | Local added sources receive immutable hash snapshots. An entered URL is presently a reference, not a fetched HTML snapshot. HTML is not an accepted starting project file.                                                    |
| HTML/CSV attachment reading                 | `packages/file-parse/src/parse.ts`                                               | These are decoded as plain text. HTML tables are not turned into typed maintained records.                                                                                                                                    |
| CSV/TSV → project workbook                  | `workspace-store.ts`, `packages/xlsx-gateway/src/gateway/csv-import.ts`          | Deterministic whole input, with a 100,000-cell project import bound. This route lacks the maintained research ledger's original HTML cell evidence.                                                                           |
| Headless worksheet creation                 | `packages/cli/src/commands/create.ts`                                            | `genoffice create xlsx --from data.csv` or a 2-D JSON array/multi-sheet JSON. This writes a workbook; it is not a research capture command or a maintained source workflow.                                                   |
| Candidate/review/publish/correction/restart | `research/store.ts`, `service.ts`, `projection.ts`, shared/preload research APIs | Reuse these seams. Research config currently supports only quotes, World Bank, enrichment and jobs. A new workflow needs deliberate IPC validation and schema/version handling.                                               |
| Immutable source evidence in native sheets  | `research/service.ts`, `projection.ts`, `metadata.ts`                            | Exact source hash, locator and excerpt must resolve through trusted ledger inputs. XLSX metadata has a 16 MiB bound; existing attribution must also be extended accurately for a web-table family.                            |
| Browser automation for verification         | `e2e/playwright.config.ts`, Electron journeys, committed Playwright lockfile     | Playwright 1.62.1 already exists. It is the development test harness, not a product browser acquisition service. Selenium is not needed to verify this next workflow.                                                         |
| Public URL safety helpers                   | `packages/electron-utils/src/safe-remote-url.ts`, `remote-image.ts`              | Public-address/per-hop validation and capped streamed body reading exist. The general fetch helper has no signal/timeout option and documents DNS-rebinding limits; it is not sufficient alone for bounded table acquisition. |

`research/engineering-policy.ts` still sets `generatedCodeExecution: false` and
rejects generated pipeline execution. A reviewed deterministic parser is an
ordinary product function; exposing an arbitrary console is a separate later
runner capability.

## Public source actually inspected

The [Government of Bermuda public-holidays page](https://www.gov.bm/public-holidays)
was opened through the web tool and independently fetched as raw HTML. The
read-only Node/parse5 probe returned HTTP 200 and four tables: 2026–2029, each
with ten body rows and two columns. Year headings and substitution notes are
outside each table. The first row uses `td`, not `th`, so treating it as column
names needs explicit confirmation. No pagination was found in the inspected
holiday content. This proves the captured page's table structure, not all
government content or future availability.

Probe at `2026-10-12T02:46:58.729Z` (11 October locally): 128,694 bytes, SHA-256
`b8019b8ce058c3bbc7e771052c496f6225b3ddd5aa63c6072da79a8fe1fc709f`.
One request took 616 ms; parse/walk took 18 ms. These are single development
observations, not application benchmarks. Raw bytes were not added to the repo.
The earlier request returned 128,709 bytes with consistent inspected table
structure: a changed page hash alone must not be described as changed facts.

An independently transcribed 2026 oracle can check the complete selected table:

| Holiday             | Calendar date |
| ------------------- | ------------- |
| New Year's Day      | 2026-01-01    |
| Good Friday         | 2026-04-03    |
| Bermuda Day         | 2026-05-22    |
| National Heroes Day | 2026-06-15    |
| Emancipation Day    | 2026-07-30    |
| Mary Prince Day     | 2026-07-31    |
| Labour Day          | 2026-09-07    |
| Remembrance Day     | 2026-11-11    |
| Christmas Day       | 2026-12-25    |
| Boxing Day          | 2026-12-26    |

These ISO dates are **test expectations**, not permission for a generic parser
to rewrite the source's date text. Boxing Day's substitution note identifies
28 December 2026. Preserve that note and flag it; importing the published date
column does not justify calling the result an observed-business-day calendar.
The source provides the dates and notes directly. [Official source](https://www.gov.bm/public-holidays)

## Deterministic parser implemented in this iteration

`apps/shell/src/main/research/html-tables.ts` now implements `parseHtmlTables`
and `htmlTablesDataset`. Discovery returns complete source rows, context and
notes, distinct table/column identities, exact proof units and support findings.
Conversion requires a selected table and explicit unique/nonblank key columns;
unmarked `td` headers require confirmation. It preserves source strings and
missing values. Actual outside-table note text and its locator survive into
accepted dataset issues and exported metadata. More than 20 notes, 2,000
characters in one note or 20,000 total note characters block conversion; note
meaning is never truncated. It does not execute scripts or perform HTTP requests.

The shared `publicHtml` helper accepts an optional source-location flag, with
unchanged defaults for existing job parsers. This enables refusal of a table
that parse5 would otherwise repair after a truncated capture. No dependencies
or framework installations changed.

The actual implementation was independently run against the official source at
`2026-10-12T03:00:31.162Z`: all four year tables were supported, all 40 records
converted, all four outside notes retained, and 96 proof units were returned.
This response was 128,589 bytes, SHA-256
`a49fab3788d0886e3bc049aecc3be584b1369da63d3291868944fc732bdf5577`.
Live HTML exposed an unrelated **Next image** dialog and an empty year heading:
the parser now distinguishes the image control from paging and retains the
nonempty 2028 heading. Both cases have regression coverage.

`research-html-tables.test.ts`, `research-job-sources.test.ts` and
`research-jobs.test.ts` passed together: **38 tests passed, two opt-in checks
skipped**. The 205-row test independently checks complete data, sum 961.25,
literal formulas/identifiers through XLSX projection and exact snapshot proof.
Shell type checking passed. This is parser/unit/live-source evidence; it does
not establish an integrated native HTML-table journey.

## Recommended integration

Connect the bounded parser to immutable captured HTML sources. Expose
context/column names/complete row counts, let the user select the table and key
columns, then reuse the accepted research ledger and XLSX projection. All values
initially remain source text; blank cells remain missing. Use the captured source
bytes for every cell locator and excerpt.

Suggested simple flow:

1. Enter the official URL or add a saved HTML file.
2. Choose **2026 — 10 rows, Holiday / Date** from the discovered tables.
3. Confirm **First row contains column names** and choose Holiday as the key.
4. Inspect the sample and visible **Notes outside the table** notice.
5. Build all ten rows, review and save the accepted sheet.
6. Add a personal note; refresh later and review changes while that note survives.

Keep the public-URL capture seam separate from parsing: reviewed HTTPS scope,
credential-free requests, bounded timeout/cancellation, redirect validation,
capped streaming body and durable bytes before the cursor advances. Do not
install a new scraping framework. If a source is client-rendered, prefer its
reviewed public structured endpoint. Browser paging is justified only where the
source actually requires it and a full count/end condition can be verified.

The inherited `htmlText` joins all child nodes with spaces. An executed synthetic
probe produced `1 st January` for an ordinal split by `sup`, and `1, 234 .50` for
a number split by `span`. Add table-cell-specific text handling that preserves
inline numeric text, without changing existing job adapters or inferring types.

## Completeness and evidence gates

- Distinguish **all rows of this selected captured table** from **all results on
  the website**. A static DOM cannot prove completeness of a virtual table.
- Retain heading/caption and adjacent notes, with their own source locators.
  Generic dates, units and currencies cannot be inferred from missing context.
- Refuse ragged rows, nested/explicit layout tables, ambiguous/duplicate/blank headers,
  unsupported spans, oversized fields, missing table closure and inconsistent
  advertised counts. Never silently pad, deduplicate or truncate.
- Detect active next/load-more controls and partial/virtual-grid indicators.
  Mark these captures incomplete rather than accepting their first visible page.
- Keep rows with repeated identical source values; require an explicit unique,
  nonblank business key before maintained publication. Repeated header rows are
  an ambiguity, not data to silently delete.
- Derive stable identities from table context/headers, source identity and the
  chosen key values. Do not derive maintained row identity from DOM position or
  changing source-version hashes. Reordering source rows must preserve keys.
- Persist exact snapshot bytes, retrieval time, source identity, method and
  cell-level locator/excerpt. Hash failure or an excerpt that does not resolve
  blocks evidence. A source website changing later cannot rewrite prior proof.
- Refresh compares source facts and context warnings separately from page
  decoration. Failed/incomplete acquisition leaves accepted data unchanged.

## Independent fixture and verification plan

Use a synthetic 205-row catalogue to cross the existing 100-row preview boundary.
IDs run `000000`–`000204`; the source amount text for row index `i` is
`(i % 10 + 0.25).toFixed(2)`. Expected count: 205; last ID: `000204`; independently
calculated amount sum: **961.25**. Source amounts and zero-prefixed IDs remain
text. Include a blank description, an inline numeric span, an inline ordinal,
quoted text and a string starting with `=` that must remain a literal cell.

Separate negative fixtures cover a missing cell, duplicate chosen key, repeated
header, merged/nested layout, two anonymous same-schema tables, a next link,
unclosed table and an advertised total larger than the captured body. A changed
header/heading is a schema change; a preceding advertisement or changed footer
is a decoration change. The latter must not churn row identities.

Unit proof should establish exact full data/evidence and failure gates. The next
native journey must exercise discovery, selection, sample/full counts, page 3,
accept, a personal correction, restart, exact source evidence, manual refresh
and retained corrections. Export QA must independently inspect the complete
worksheet and research metadata, not only the first preview page.

Measure first-time and repeat use separately: actual user clicks/keystrokes,
provider/agent turns, HTTP requests and bytes, parser time, time to reviewed
sheet, records/expected records and unresolved issues. Target zero agent turns
for this deterministic capture, one page fetch for this static source and no
row-by-row browser interactions. Report medians/ranges over repeated runs and
count permission/setup/retry actions instead of hiding them. A faster task is
successful only when its coverage and evidence gates still pass.

## Remaining boundary

This iteration demonstrates a fitting primary source and a tested deterministic parser.
It does not claim that the new capture UI, HTTP acquisition, observed-date
normalization, browser ingestion or maintained HTML-table workflow has already
run. Those capabilities require their own integration and native evidence.
