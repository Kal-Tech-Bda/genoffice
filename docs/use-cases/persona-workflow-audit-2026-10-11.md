# Infomonk persona and workflow audit — 11 October 2026

The supported workflows preserve evidence and accepted data well, but collecting
more rows has exposed a usability gap: finding the useful rows, deciding what
actually changed, and knowing which edits survive refresh take too much work.
An arbitrary public website table also has no collection path yet. These are
workflow problems to resolve before the engineering harness, which remains last
and disabled.

This audit inspects baseline `bd316fe341a9078c3e9ae84bb339d7ae4624f27f`.
The personas below are fictional test users, not claims about interviewed users.
Action sequences describe the current controls; they are not measured click or
completion-time benchmarks. Proposed acceptance checks are targets, not passing
results. Later implementation should record its actual measured results separately.

## Evidence boundary

**Inspected** means source code, retained result records or screenshots examined
for this audit. **Prior runtime-tested** means an earlier native Electron journey
has recorded the behavior; no new application runtime was executed for this audit.
Existing runtime records do not prove the usability targets below have been met.

| Evidence                                                                                                                                                                                                                         | What it establishes                                                                                                                                                         | What it does not establish                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [ResearchPanel](../../apps/shell/src/renderer/src/infomonk/ResearchPanel.tsx), [page API](../../apps/shell/src/shared/research-api.ts), [paging implementation](../../apps/shell/src/main/research/pages.ts)                     | Inspected task choices, scope confirmation, sample/full actions, 100-row paging, Needs review, cell inspection and correction controls                                      | Completion time, discoverability or accessibility for an unfamiliar user                          |
| [Workspace](../../apps/shell/src/renderer/src/infomonk/Workspace.tsx), [project creation](../../apps/shell/src/renderer/src/infomonk/ProjectCreator.tsx), [workspace storage](../../apps/shell/src/main/workspace-store.ts)      | Inspected starts, source snapshots, reference-only URLs, remembered workbook and outputs                                                                                    | Arbitrary website/table collection or source-backed report creation                               |
| [Expanded jobs report](bermuda-jobs-wide-2026-10-11.md), [execution manifest](../testing/bermuda-jobs-wide-2026-10-11/results.json), [independent quality results](../testing/bermuda-jobs-wide-2026-10-11/quality-results.json) | Prior runtime-tested 19 configured checks, 138 source listings, 43 coverage targets, personal tracking, reviewed refresh, revision 5, restart and native HTML/JSON evidence | Exhaustive Bermuda search, distinct vacancy count, all descriptions or current eligibility        |
| [Supplier comparison result](../testing/workspace-flow-2026-10-10/use-case-results.json), [process journeys](../testing/process-journeys-2026-10-11.md), [readiness journey](../testing/input-readiness-2026-10-11/journey.json) | Prior runtime-tested supported quotes, missing/conflicting facts, explicit source repair, correction preservation, formulas, export and independent workflow reuse          | Extraction of ordinary unlabelled quotations, OCR, a novice's task success or a comparison report |
| [Public-data verification](../implementation/research-verification.md), [World Bank adapter](../../apps/shell/src/main/research/worldbank.ts)                                                                                    | Prior runtime-tested 18 population observations across two pages; inspected bounded API validation and scope                                                                | Arbitrary tables, indicators, browser acquisition or market-wide search                           |
| [Jobs light capture](../testing/bermuda-jobs-wide-2026-10-11/wide-tracker-light.png), [readiness light capture](../testing/input-readiness-2026-10-11/blocked-inputs-light.png)                                                  | Visually inspected actual native captures: legible text, explicit missing facts, source context and readiness reasons                                                       | Current interaction behavior, keyboard reachability or responsive layout at every size            |

The root contributor guidance was read. No product code, dependency, existing
research document or runtime profile is changed by this audit.

## Persona 1: Maya, Bermuda job seeker and researcher

Maya has limited time after work. She wants technology, data and office roles,
prefers direct employer evidence, and returns weekly to review a shortlist. She
needs to distinguish an open vacancy from a talent pool, an expired advertisement
and an unknown deadline. She should be able to maintain her own progress without
changing what an employer actually said.

**Successful outcome:** a relevant shortlist with source links, visible gaps,
personal notes and a repeatable manual refresh. No application is sent by this
workflow. The denominator is source listings, not distinct confirmed vacancies.

### Current action sequence

1. Create a project and open Workflows. Select **Bermuda jobs → manual tracker**.
2. Name the workflow, select the public websites and save. The existing **Select
   all supported websites** avoids 19 separate checkbox decisions when the user
   wants the full supported view.
3. Run all confirmed inputs; collection uses the durable queue and automatically
   follows the supported pagination/detail routes. The user does not need to open
   every page individually.
4. Choose **Review candidate**. Read coverage, scan the Jobs table, and navigate
   the 100-row pages. **Show all job fields** exposes further fields.
5. Click a title or fact to inspect its evidence and **Verify snapshot and
   locator**. Open the live listing when current details are needed.
6. Acknowledge issues and publish. Missing facts can remain missing; partial
   configured searches remain explicitly partial.
7. Choose **Inspect accepted table**, find the role again, select application
   status or notes, supply a tracking reason and save the update.
8. On return, choose **Refresh job listings**, review the new candidate and
   publish. Saved status and notes survive. Reopening uses the accepted owned
   workbook, and Details can resolve the immutable source evidence.

Steps 3–8 have prior native runtime evidence in the expanded jobs manifest.
The exact actions were inspected in ResearchPanel. The awkward part is step 4
and repeated finding in step 7: the baseline has no title search, role/source
filter or Saved view in this inspector. Needs review tests nulls and issues, so
it does not answer “show my shortlist” or “show data roles.”

### Friction and proposed checks

| Rank | Friction and user impact                                                                                                                                                | Improvement to verify                                                                                                                        | Measurable acceptance check                                                                                                                                                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Scanning 138 listings to find a relevant role is slow; 106 employer identities and 129 employer deadlines are missing, so Needs review is broad rather than a shortlist | Search and combine role, source and personal-status filters across the entire dataset; persist each workflow's view                          | In a 250-row fixture with a matching Saved data role beyond row 100, three user actions from the accepted inspector reveal it. Display matching/all counts; clear restores 250 rows. Filter does not change publication, revisions or dataset contents                         |
| 2    | Presence, availability, publication expiry and employer deadline require careful interpretation; two known employer deadlines are already past                          | Give each condition an explicit label and keep unknown distinct; provide useful availability filters without inferring closure               | Freeze the review date in a fixture. A past employer deadline, future deadline, unknown deadline, publication expiry and talent pool remain distinguishable. The expiry-only row is never labelled employer-deadline expired or closed                                         |
| 3    | A personal note/status requires the general correction inspector and a reason for every update; editing the native sheet means something different                      | Make the tracking action obvious near each row while retaining the existing audit record; explain which surface produces a persistent update | From a role in the inspector, Save to shortlist takes no more than three actions. Note/status survive refresh and restart; employer facts remain read-only; the new revision records who/what/when and the actual reason                                                       |
| 4    | Refresh reports source changes together with fact changes; a row can look changed because the page hash or observation changed                                          | Separate changed job facts from refreshed observation/evidence and personal tracking                                                         | Refresh a fixture whose page bytes/time change but title, employer, location and deadline do not. Report zero changed job facts while retaining the newer observation/evidence. Change one deadline and show exactly that field's prior/new value                              |
| 5    | Manual employer checks live in a research source or note rather than a first-class listing observation                                                                  | Capture manually checked leads with their own evidence and scope, then reconcile observations explicitly                                     | Add a BHB lead with image deadline 20 October and portal deadline 21 October. Both observations and links remain visible; unresolved conflict stays flagged. Do not silently fill a board's unknown employer/deadline or count the two observations as two confirmed vacancies |

The existing 20/21 October BHB deadline ambiguity is a useful regression case.
Its reviewed personal note is prior runtime-tested; a general manual-observation
capture/reconciliation workflow is not implemented at this baseline.

## Persona 2: Jordan, procurement analyst

Jordan needs to compare three supplier quotes, explain a missing or conflicting
total to a manager, and update the comparison when a supplier revises a document.
Jordan is comfortable with spreadsheet formulas but does not know ledger
terminology. A persistent correction should not be confused with changing a
displayed cell, and a copied workflow should be ready to configure for the next
purchase without carrying the previous suppliers' records.

**Successful outcome:** a reviewed comparison with source-linked facts, explicit
missing totals, retained original documents, clearly identified manual
corrections and an export that corresponds to the chosen accepted revision.

### Current action sequence

1. Create a project from a quote file. The file start opens Sources; add the
   other quote documents as immutable snapshots.
2. Select **Build a table from sources**. Choose Supplier quotes, the snapshots
   and typed fields; save the workflow.
3. Run **Check input readiness**. Inspect the actual blocked/review excerpts.
   Repair via **Update snapshot** or explicitly exclude unsupported inputs;
   save and recheck. A full request repeats the check before queueing.
4. Optionally run a diagnostic sample. Run all confirmed inputs directly when
   ready; the completed sample stays in history and does not need cancellation.
5. Inspect missing/conflicting facts, acknowledge and publish. Quote ID links
   each quote to its related Line items sheet.
6. Use **Inspect accepted table** to enter a correction and reason. Open the
   accepted workbook for formulas, formatting, native undo and saving.
7. Update revised source snapshots. Refresh the workflow, review changes and
   publish; corrections take precedence over incoming facts and keep evidence.
8. Save the workbook and export XLSX. Start a new project from the workflow for
   the next purchase; choose its new inputs explicitly.

This sequence is source-confirmed and supported parts are prior native-tested
in the supplier comparison, readiness and process journeys. The real limitation
is earlier than step 2 for ordinary quotes: the deterministic extractor requires
exactly one **Supplier Quote** heading and labelled fields. Scanned PDFs,
unlabelled business quotes and other document families are not understood.
Free-text workflow instructions do not expand the extraction rules.

### Friction and proposed checks

| Rank | Friction and user impact                                                                                                                          | Improvement to verify                                                                                                                     | Measurable acceptance check                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Real quotation layouts may fail despite the file picker accepting PDF/DOCX. The user discovers family limitations after importing and configuring | Show document support/readiness close to source intake and provide a usable next action for each unsupported input                        | Import one supported labelled quote, an ordinary unlabelled quote and a scan. Each has an explicit status and supported next action before full execution. Nothing is silently dropped and no total or Quote ID is invented                                                              |
| 2    | A saved native cell edit can be overwritten in a later projection because it is a file edit, while ledger corrections persist                     | Offer the persistent correction action from sheet Details and clearly distinguish accepted value, saved sheet value and incoming evidence | Select a changed accepted cell in Sheets. Within two actions, reach the correction action using the same row/column identity. Refresh/restart preserves a reviewed correction; an ordinary file edit remains labelled as such and is not silently promoted to source fact                |
| 3    | “Instructions / notes” invites natural-language expectations that fixed rules cannot meet                                                         | Make supported execution choices primary and context notes visibly secondary                                                              | Enter “extract tax and delivery date.” Before run, display that these fields are outside the chosen schema. Execution remains within confirmed fields; the interface never implies that notes created new extraction behavior                                                            |
| 4    | Comparing totals across currencies or confusing an item calculation with payable total can create an incorrect decision                           | Provide a comparison view of accepted fields, currency, missing facts and source references; calculations must state assumptions          | Use three same-currency quotes with one missing total: lowest stated total is correct, missing is excluded explicitly, quantity × unit price does not fill the missing payable total. Add a different currency: do not rank raw amounts as comparable without a confirmed conversion     |
| 5    | Creating a manager-facing output still means manually opening a secondary editor and composing a report                                           | Generate a reviewable comparison from a selected accepted revision using inherited document/export writers                                | The output identifies revision, quoted totals, missing/conflicting facts, currency and resolvable evidence links. A later refresh leaves the old report's revision identifiable. The source-backed report is not counted as implemented merely because Document/Markdown creation exists |

The current independent comparison fixture is useful: initial totals 100, 90 and
null; a reviewed manual 108; revised incoming 120, 90 and 115; accepted 120, 90
and manual 108. Existing native tests prove the formula result 90, saved export
and correction preservation. They do not prove report generation or generic
document extraction.

## Persona 3: Priya, recurring public-data researcher

Priya maintains a table from a public agency website each month. It may offer an
API, CSV download, static HTML table or a JavaScript-rendered paginated view.
She wants to acquire the complete table once, inspect its coverage and refresh
it later. She should not need to ask an assistant to read every displayed row or
write a new scraper each time the same table is revisited.

**Successful outcome:** a saved acquisition recipe with explicit page/table
scope, stable row keys, a full-record count, typed cells and immutable evidence.
Failures leave accepted data intact. A complete-looking visible page must not be
mistaken for the complete dataset.

### Current action sequence and stopping point

1. Choose **Research the web**, enter a project goal and optionally paste a URL.
2. The URL is stored as **Link only · not collected**. Opening it uses the
   external browser; there is no generic table acquisition action.
3. Workflows offers World Bank population, the selected Bermuda jobs sites,
   supplier quotes and quote enrichment. A pasted agency URL is not added to
   those supported fetch routes.
4. For the supported population case, confirm ISO3 countries and years, save,
   run, review and publish. The adapter validates pagination, totals, indicator
   and country/year scope and stores JSON evidence before advancing acquisition.
5. For an arbitrary table, the user must obtain a CSV/TSV/XLSX outside the
   application and start/import a spreadsheet project. This gives native editing
   and saved cleanup, but does not establish the web acquisition recipe,
   source-cell evidence or refresh relationship of a maintained research table.

Steps 1–3 and 5 are inspected source behavior. The bounded World Bank path has
prior live runtime evidence. A general public-table or browser capture journey
is missing, rather than merely slow.

### Friction and proposed checks

| Rank | Friction and user impact                                                                                            | Improvement to verify                                                                                             | Measurable acceptance check                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | An arbitrary URL cannot become a maintained table                                                                   | Add a reviewed public-table intake route that reuses snapshots, queue, candidate review and accepted projections  | A local fixture with two HTML tables allows explicit selection. The selected 240-row table is acquired in bulk and produces all 240 unique rows, headers and source locators. No per-row model call is needed. The unrelated table is excluded, and nothing is accepted before review |
| 2    | A console script or browser scraper can capture only visible rows, repeat pages or stop early without a clear error | Validate API totals/pagination or declared DOM scope; fail or label partial coverage explicitly                   | Exercise two pages, a repeated page, changed headers, one failed page and a virtualized viewport. A complete claim requires independently expected whole-table count and unique keys. Each incomplete case is visible and cannot silently replace accepted complete data              |
| 3    | Users may repeat an expensive discovery process every refresh                                                       | Save a versioned acquisition recipe and cache retained bytes/parsing for retries; new refresh reacquires          | Restart and run the saved workflow without rewriting extraction logic. An interrupted retry reuses acquired inputs; a deliberate refresh fetches current bytes. Record requests, parser executions and total acquisition time, without claiming token savings from intent alone       |
| 4    | Types, merged headers and record identity are ambiguous in arbitrary tables                                         | Preview headers and typed values, require a reviewed key and preserve raw values/evidence                         | Include leading-zero IDs, dates in two formats, footnotes, a merged header and null numeric data. Preview exposes ambiguity. IDs stay text; missing stays null; duplicate keys need explicit resolution before publication                                                            |
| 5    | Dynamic pages invite framework installation even when a public download/API is already available                    | Inspect bulk machine-readable routes first; use browser automation only where rendering or pagination requires it | For API/CSV fixtures, acquisition uses the whole response/download and verifies its count. For a JS-only fixture, the browser path records the rendered scope and completion condition. Both share the evidence and review contracts; no additional execution harness is introduced   |

The user's script/console suggestion directly addresses the repeated-row cost.
The existing jobs adapters already collect multiple records from each HTML/JSON
response; the World Bank path collects complete response pages. Those functions
should be reused. A new Selenium dependency or unrestricted generated scripts
are not prerequisites for bulk extraction. Browser-mediated capture, if needed,
must retain the same explicit source scope, coverage and immutable evidence.

## Ranked cross-workflow changes

| Priority | Change                                                              | Why it is next                                                                                 | Acceptance evidence                                                                                                           |
| -------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1        | Whole-table search and filters plus a visible shortlist             | Improves the live 138-listing use case immediately without inventing new facts                 | Cross-page unit checks, native filtered tracking/refresh/restart journey and measured actions/time                            |
| 2        | Public-table acquisition with reviewable scope and coverage         | Unblocks a named user workflow rather than making only the fixed families more comfortable     | Independent static/dynamic/paginated fixtures, complete and partial cases, immutable locators and a native end-to-end journey |
| 3        | Facts-only refresh summaries beside observation/evidence changes    | Reduces repeated review caused by regenerated pages and makes genuine changes easier to assess | No-fact-change and one-field-change fixtures; native prior/new inspection                                                     |
| 4        | Persistent correction/tracking action from the place the user works | Removes the accepted-ledger versus sheet-edit surprise                                         | Sheet-originated action retaining exact identity; refresh/save/restart and rejected ambiguous identity                        |
| 5        | Source-backed comparison/report output and manual observations      | Completes the evidence-to-decision workflow and integrates employer cross-checks               | Independent expected report facts/revision/links; manually conflicting observations remain explicit                           |

`diffDataset` in [ResearchStore](../../apps/shell/src/main/research/store.ts)
currently includes snapshot hashes in changed-row comparison alongside values
and missing reasons. This is inspected evidence for priority 3; a general
“nothing important changed” review has not yet been runtime-verified.

## Visual and interaction checks for each increment

The inspected jobs capture uses a clear navigation rail, source subtitles and
distinct missing-value badges. The large table also creates nested scrolling,
variable row heights and repetitive availability text; long names are truncated
in the navigation. The readiness capture makes blocked inputs and actual excerpts
readable, but its full-page findings can require a long scroll to the next action.
These are observations of retained captures, not a new runtime inspection.

Verify the improved state in actual Electron at 900 px and a normal wide window,
in light, dark and system themes:

- Keep search/filter controls, matching/all counts and the primary next action
  discoverable above the table. A selected detail and pending draft must not be
  cleared merely by changing view filters or receiving a stale response.
- Maintain readable role/source/status hierarchy, useful empty-filter guidance,
  semantic theme tokens and column labels that remain available while scrolling.
  Essential identity/actions should not require horizontal scrolling at 900 px.
- Tab through search, filters, rows, evidence and the next action in a predictable
  order, with visible focus and accurate accessible names. Do not use color alone
  for missing, partial, blocked or manual states.
- Record cold startup, acquisition, review and return-to-shortlist time separately.
  Compare actions/time on the same fixture before and after the change. Fewer
  model calls or lower token usage must be measured if reported as a result.
- Preserve coverage boundaries, originals, accepted revisions, corrections and
  immutable evidence through filters, failed refreshes, cancellation and restart.

Existing durable storage, source snapshots, queue, native editors, pagination,
readiness, correction history and projections already solve important parts of
these journeys. Iterations should extend those paths and verify real user tasks
before moving to the deferred engineering harness.
