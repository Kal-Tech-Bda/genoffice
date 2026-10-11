# Workspace process journeys — 11 October 2026

This review extends the supplier-comparison journey with four realistic paths:
mixed-quality inputs, reviewed source removal, workflow reuse and spreadsheet
cleanup. The supported paths now have clearer next actions and stronger correction
and relationship safeguards. The engineering harness remains **last and disabled**.
`assay.md` was excluded; no new parser, framework, dependency upgrade, hosted
service, provider request or credential change was needed.

## Process findings and fixes

| Finding                                                                                 | Resulting behavior                                                                                                                                                                                          | Evidence                                                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A completed sample required cancellation before full execution                          | Run all confirmed inputs atomically supersedes the completed sample, retaining its inputs, candidate and events in history. Active samples/full candidates remain fenced; schedules do not supersede review | ResearchStore queue, ResearchService, ResearchPanel; rollback/overlap tests and desktop journey |
| Copying a workflow into a project led to a blank workbook                               | Opens the copied workflow, shows empty-scope guidance, disables Run, and provides Choose workflow inputs. The configuration opens and scrolls into view; newly added sources require explicit selection     | Workspace, ResearchPanel, createFrom; independent-project desktop journey                       |
| Ordinary corrections could change business keys without reconciling related rows        | Quote IDs and population country/year keys are inspectable but read-only in corrections. The service rejects changes before creating a file or revision                                                     | Shared identity rule, service and inspector; unit rejection and native Quote ID inspection      |
| A corrected item could survive removal without its parent quote                         | Reviewed removal retains the protected quote and related items when any row in that relationship has a correction. Unprotected absent relationships remain removable                                        | ResearchStore prepare; parent/child tests and Cedar/Northwind desktop removal journey           |
| Corrections validated types/dates but allowed invalid negative facts or malformed codes | Negative amounts, quantities and population, malformed uppercase three-letter codes and invalid dates are rejected before projection. Null remains explicitly missing; zero is permitted                    | ResearchService correct; focused rejection tests and native negative-total rejection            |
| Closing cleanup changed the shell section without reopening the editor                  | Close activates the actual remembered workbook. Cleanup names its saved primary input and warns when the working workbook differs                                                                           | Workspace and CleanupFlow; native CSV discard/Close/apply/version journey                       |

Completed samples use the existing `obsolete` history state after full execution
is requested. This is a retained diagnostic record, not a publishable candidate.
No database schema migration or public IPC signature change was necessary.
Protecting related rows deliberately makes reviewed deletion more conservative.
Existing historical key edits are not rewritten or migrated by this change.

## Executed use cases

Expected business facts were written independently of extraction. Fixtures live in
[`fixtures/infomonk/journeys`](../../fixtures/infomonk/journeys/README.md), with
the existing research and three-supplier fixtures reused. This is workflow
verification, not an accuracy benchmark or the deferred engineering harness.

1. **Mixed documents:** valid Q-100 plus a conflicting copy and unsupported
   meeting notes. Sample shows one quote and cannot publish. Full coverage is
   2/3 with one failure and publication remains blocked. Explicitly excluding
   the unsupported input and saving a new configuration obsoletes the incomplete
   candidate. The rerun has one quote with a missing total and three exact source
   excerpts (125.50, 125.50, 130.00). Verified evidence remains available. After
   acknowledged publication, a negative correction is rejected without advancing
   revision 1. A reviewed correction to 130 creates revision 2 with manual origin.
2. **Source removal:** accept Northwind, Cedar and Maple, leaving Maple's total
   missing. Correct Cedar's item quantity to 4 with a reason. Exclude Northwind
   and Cedar from confirmed scope. Default publication retains all three quote
   relationships; explicitly reviewed removal then removes Northwind while
   retaining Cedar's quote/item relationship and Maple's missing fact. Four
   immutable accepted revisions remain.
3. **Workflow reuse:** start a new project from an accepted workflow. No sources,
   rows, runs, overrides or schedule are copied. The new project opens input
   guidance; its existing notes/schema are accessible. Add and explicitly select
   an input, save, sample, run full and publish. The new workflow reaches its own
   revision 1; the original workflow remains at its revision 1.
4. **CSV cleanup:** preview four register records with leading-zero IDs. Trim,
   deduplicate by ID and sort preserves 001/Alpha/10, 002/Beta/15 and the
   missing-key Unassigned/4 record. Discard leaves starter bytes unchanged; Close
   returns to the editor. Apply writes a separate XLSX with those literal IDs
   and values; originals remain unchanged. Previous workbook version returns
   both primary/working pointers to the starter while retaining the cleaned file.

Permanent tests: [`infomonk-process-journeys.spec.ts`](../../e2e/infomonk-process-journeys.spec.ts)
and [`research-journeys.test.ts`](../../apps/shell/tests/research-journeys.test.ts).
Per-journey JSON records contain the isolated profile, identities, checks and
captured renderer errors. Screenshots show actual Electron windows, not mockups.

## Verification

Windows, npm/committed lockfile, Electron 43.7.6, Node and dependency versions
are recorded in [`results.json`](process-journeys-2026-10-11/results.json).
The shell build compiles all main/preload bridges. Existing built editor/native
artifacts were reused; no native engine source changed in this increment.

```powershell
npm run build -w @genoffice/shell
npm run typecheck
npm run test -w @genoffice/shell -- tests/research-journeys.test.ts tests/research.test.ts tests/research-hardening.test.ts tests/workspace-store.test.ts tests/workspace-portability.test.ts tests/workspace-flow.test.ts tests/clean-table.test.ts
$env:Path = 'C:\Program Files\Git\usr\bin;' + $env:Path
npm run test:e2e -- infomonk-process-journeys.spec.ts infomonk-workspace-flow.spec.ts infomonk-hardening.spec.ts infomonk-research-context.spec.ts sheets-edit-save.spec.ts sheets-open-tsv.spec.ts sheets-csv-inplace-save.spec.ts sheets-csv-export.spec.ts sheets-filter-reopen.spec.ts ai-panel-side-settings.spec.ts theme-pipeline.spec.ts
npm run lint
npm run format:check
npm run check:theme-colors
npm run check:english-comments
npm run licenses
```

Focused tests: **48 passed across seven files**. The final combined Electron run:
**20 passed, zero failures, retries or skips**. The four new native journeys
passed with no captured renderer errors. Existing selected Electron regressions
exercise paging/restore, context switching, supplier comparison/save/restart,
CSV/TSV, filters, assistant placement and theme propagation.

The new journeys explicitly select light theme before capture. Visual inspection
confirmed the [cleanup preview](process-journeys-2026-10-11/cleanup-preview-light.png)
and [manual total 130](process-journeys-2026-10-11/reviewed-conflict-light.png).
A separately reopened synthetic profile showed the saved XLSX value 130 and
workflow revision 2; its [native workflow summary](process-journeys-2026-10-11/manual-reopened-workflow-system-dark.png)
uses system dark appearance. That manual profile is independent of the final
automated profiles. It was closed after inspection; no production profile was used.
Historical screenshot/report records from earlier milestones were preserved.

The first regression attempt had 14 passes and two environment failures because
`unzip` was absent from this shell's PATH. Adding the already installed Git utility
allowed both unchanged tests to pass. New test development also corrected selectors
to match the real accessibility labels; application assertions were retained.
Full inherited Shell/Sheets suites were not rerun: the previously established
21 Windows path/symlink/chmod failures remain documented in the earlier report.
No full-suite-green or provider/OCR/arbitrary-web claim is made here.

## Ranked remaining process gaps

1. **Input readiness before execution.** The UI explains the supported quote
   family, but a syntactically valid file can still fail only during acquisition.
   Add a cheap local readiness step covering family/heading, unreadable/scanned
   inputs, missing keys and supported schema before a full run. Preserve failures
   and actual excerpts; do not imply OCR or arbitrary extraction coverage.
2. **Accepted table to report.** Outputs can reopen accepted revisions and create
   secondary documents, but Create opens a blank editor without carrying the
   chosen accepted revision, summary, missing facts or citations. Next implement
   a bounded source-backed report from a selected accepted table using inherited
   Markdown/DOCX writers and explicit revision/evidence references.
3. **Primary versus working table operations.** Cleanup now names its primary
   input and returns correctly, but it still cannot shape an arbitrary currently
   selected accepted research workbook. A chosen-input transformation needs a
   separate derived-workbook contract and evidence/ledger boundary before enabling
   it; never silently treat an edited XLSX as accepted research.
4. **Key reconciliation and override lifecycle.** Key editing is now safely
   blocked, but there is no explicit record-key migration, supersession or clear
   override action. Old key corrections are not automatically repaired. These
   operations need review of affected relationships, evidence and revision fences.
5. **Broader source/output/operational coverage.** Scans, invoice families,
   arbitrary sites/connectors, shared workspaces, off-computer schedules, retention
   and full localization remain bounded/deferred. Existing inherited native
   functions should continue to be reused instead of adding competing editors,
   schedulers, project storage or an agent loop.

Continue readiness and table-to-report usability before broadening extraction.
Keep the engineering harness as the final phase, consuming these accepted-data
and review contracts after the workspace workflows are stable.
