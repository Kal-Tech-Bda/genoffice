# Infomonk Stages 3–5: research and maintained tables

Implemented 10 October 2026 on the existing Electron fork. This is a bounded local
milestone. The evidence is in [research verification](research-verification.md).
The engineering harness is the final phase and remains disabled. `assay.md` is excluded.

## Try the journeys

Launch with the existing `npm run dev`, or build all editors and run
`npx --no-install electron apps/shell`. The application uses `%APPDATA%/Infomonk Dev`;
`INFOMONK_USER_DATA` selects an isolated profile.

1. Create a project from `fixtures/infomonk/research/valid.pdf`. Add `valid.docx`,
   `table.docx` and `missing.md` in Sources. Originals become immutable snapshots.
2. Select **Build a table from sources** or **Workflows**. Choose Supplier quotes,
   input snapshots and typed fields. Quote ID is the stable business key within
   this workflow. One input contains exactly one quote; items use a related sheet.
3. Save the workflow and run a sample. Click a value, verify its snapshot/locator,
   and inspect missing facts. Cancel the sample, adjust the configuration if
   needed, then run all confirmed inputs. Samples cannot publish.
4. Review the candidate, acknowledge issues and publish. Open the accepted XLSX.
   Select a cell and open Details to inspect its evidence or native source copy.
5. Use **Inspect accepted table** to record a correction and reason. Corrections
   create a new accepted revision and take precedence on subsequent refreshes.
6. For web research choose World Bank population, confirm ISO3 codes and years,
   run, inspect evidence and publish. For enrichment choose an accepted quote
   workflow containing `country_code`; confirm the public scope separately.
7. Edit/run workflows, inspect history and added/changed/absent records, retry
   interrupted processing or cancel a run. Scheduling can be manual, every
   15 minutes, hourly or daily while the app is open; pause/resume is persistent.

Sources → Update snapshot retains the source ID and previous immutable versions.
Open previous inspects a saved version; it does not revert accepted data. Home
flags changed selected inputs, and Workflows shows the accepted timestamp and
refresh requirement. A queued run uses the local versions confirmed at queue
time. Changed inputs block publication, including a change while projecting
the output file. Cancel a stale candidate and run with current snapshots.
An external original changing on disk is not automatically watched or imported.

Home → Needs review selects projects with pending candidates, unresolved accepted
facts or changed configuration/inputs. Review table opens the applicable workflow.
Within a table, Needs review filters missing values and validation issues across
the complete table, then pages the result. Manual corrections remain identifiable
as manual even when the filter no longer contains that row.

Outputs distinguishes the current accepted revision from earlier immutable
ledger revisions; native edits to an XLSX are separately owned file edits.
Activity links real run events and correction records. Opening a published or
explicitly selected owned workbook makes it the remembered working workbook;
cleanup remains attached to the original/cleaned primary workbook.

## Supported extraction

The deterministic supplier-quote extractor requires the heading `Supplier Quote`
and labels `Quote ID:`, `Supplier:`, `Date:`, `Currency:`, `Total:` and optional
`Country code:`. Dates are valid ISO dates; currency/country codes are uppercase
three-letter codes; amounts are plain nonnegative decimal numbers. Missing or
conflicting facts stay missing with reasons and evidence where available.

Text PDF, DOCX and UTF-8 text/Markdown are supported. DOCX additionally supports
two-column label/value tables and flat item tables with the exact header
`Item | Description | Quantity | Unit price`. Pipe-delimited text items use
`Item 1 | Paper | 5 | 20.00`. Repeated items form **Line items**, linked by Quote ID.
Inputs are at most 32 MiB, parsed text 200,000 characters and items 1,000 per document;
each workflow selects at most 20 source snapshots. Scanned/empty PDF pages,
truncated parsing, unsupported families and failed files produce incomplete coverage.
Publication cannot proceed with failed or incomplete input coverage.

PDF evidence uses page and content-order line; DOCX uses original OOXML body
element plus table row/cell when available. These are exact text/structure
locators, not visual bounding boxes. The inspector verifies bytes by SHA256 and
resolves the locator. Native viewing opens a separate copy of that snapshot;
it does not promise automatic page scrolling/highlighting. DOCX table label/value
normalization explicitly pairs the adjacent label and value cell.

No arbitrary document understanding or live model extraction is claimed.
Workflow free-text notes are versioned context; fixed task rules define execution.
The [parser comparison](parser-comparison.md) explains why the inherited paths
remain in use. No Python parser became an application dependency.

## Public adapter and matching

The only adapter is the documented World Bank V2 `SP.POP.TOTL` endpoint.
It accepts up to ten explicitly confirmed ISO3 codes and three years: 30 records,
ten records per page, at most three sequential pages. Page metadata, complete
record counts, uniqueness, indicator and country/year scope are validated.
Responses are limited to 2 MiB; requests time out after 20 seconds, redirects are
rejected and 429/5xx responses receive at most three attempts with bounded backoff.
No guaranteed rate allowance is invented; rejection remains a retrieval error.

Every response is persisted by content hash before the acquisition cursor
advances. Cells retain URL, retrieval time, snapshot hash, extractor version and
JSON pointer. Null observations remain missing. Live retrieval evidence and
injected HTTP fixtures are separately labeled in verification.

Enrichment reads an accepted internal quote revision locally. Requests contain
only the confirmed public country/year scope, never supplier names or document
text. Exactly one matching country/year observation supplies external population
fields. Missing, out-of-scope or ambiguous codes remain entity-match review issues.
Internal, external and manual origins are visible. A changed internal accepted
revision invalidates publication of an older enrichment candidate.

World Bank is credited in the UI, evidence and exported metadata. See the
[API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures)
and [dataset terms](https://data.worldbank.org/summary-terms-of-use).
This small population dataset is not exhaustive web research or a proprietary
dataset copy. There is no search/snippet verification or browser scraping path.

## Authoritative storage and execution

`userData/infomonk-research.sqlite` is the accepted ledger and single durable queue.
It uses the inherited Node SQLite runtime, WAL, foreign keys and transactional
migrations through schema **2**. It is distinct from the disposable file-search
index and from ProjectStore UI/chat JSON. Tables cover workflows/configuration,
runs, durable acquired inputs, execution/validation events, immutable accepted
revisions, normalized accepted cells and independent correction history.

Contracts include project ID, schema version, stable table/row/column IDs,
source ID/version, typed candidate/accepted value, missing reason, evidence,
method, validation issues, attempts, human correction and revision. Quote IDs
and numbered item keys deduplicate repeated copies. Population IDs derive from
indicator/country/year. Conflicting duplicate quote values produce review issues.
IDs are written explicitly as XLSX text even if they resemble scientific notation.

Acquisition cursor, configuration version, processing version, execution
checkpoint and accepted revision are separate. Retrying reuses durable acquired
inputs; a new run reacquires web data. Configuration changes obsolete pending
runs. Interrupted active work becomes a failed resumable run on restart. Queued
work is durable. Cancellation/obsolete configuration/incomplete coverage or a
changed accepted revision cannot publish. SQLite transactions atomically replace
accepted cells and advance revisions; failed file writes happen before that
transaction. A crash can leave an unreferenced generated XLSX, never a partly
accepted dataset. Opening an accepted output repairs ProjectStore membership.

Publication requires explicit review and creates a separate XLSX revision; the
source and original project workbook remain intact. Diffs compare stable row
keys, values, missing reasons and source hashes. Absent rows are retained by
default. Explicit reviewed removal deletes non-overridden absent rows; rows with
manual corrections are retained. An access failure is never treated as deletion.
Fields with corrections cannot be silently removed from a quote schema.

XLSX is a projection, not the ledger. It contains the hidden record ID, readable
widths and linked `infomonk/research.json` including dataset/evidence metadata.
Native edits are allowed; Details warns if a current value or file revision
differs from accepted data. Use the correction action for persistent overrides.
Header/worksheet renaming, arbitrary helper edits/copies and CSV export do not
have automatic identity reconciliation. Full-row sort guards are inherited.
Export workbook uses the active project-owned XLSX; Clean table is restricted
to the saved primary project workbook. Accepted research revisions appear in Outputs.

Scheduling uses this same queue and always stops at candidate review. It requires
the open desktop application; no off-computer or hosted-worker execution is
claimed. Missed times coalesce to one acquisition on reopening. Pending review
prevents overlapping reruns. Template copying retains task/schema/notes but clears
source IDs, country selections and parent references; it contains no accepted
records, corrections, schedule or credentials.
**Start a new project from this workflow** creates a separate project and blank
workbook with the saved task/schema/notes. Inputs and any enrichment parent must
be selected in that project before running. The same-project copy action remains.

History returns 20 indexed summaries per page plus the latest summary for each
workflow; polling waits for completion before scheduling another read. Selected
candidate/accepted table previews contain 100 rows per table, full row counts
and evidence counts. Full cell evidence/prior values load on demand by validated
project/workflow/run/table/row/column identity. Actual absent records are calculated
against the whole candidate on the server and paged separately. Table previews
never control publication or deletion. Selected-run events show the latest 100.

Publication and correction reject serialized research metadata exceeding
16,777,216 characters before file generation or ledger writes. This matches the
sheet evidence reader. Split oversized input batches; per-file bounds alone do
not promise that every permitted batch can publish. Full evidence remains in
accepted storage and supported XLSX projections.

Use the [backup/restore CLI](workspace-recovery.md) for consistent SQLite and
owned-project recovery. Startup relocates legacy copied profiles before opening
the queue. Restored schedules pause and active/queued runs require explicit retry.
No retention or automatic pruning exists. A future hosted service should migrate
the same identities, revisions, evidence and cursor/checkpoint contracts behind
this service boundary; no second scheduler or PostgreSQL service is added.

See [hardening verification](../testing/hardening-2026-10-10.md) for native paging,
template creation, restore without the original profile and revised IPC timings.
