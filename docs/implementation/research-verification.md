# Infomonk Stages 3–5 verification

Executed 10 October 2026 on Windows x64, built Electron renderers. Branch:
`codex/infomonk-workspace`; full-history upstream base:
`1ca5e9adfc1807a158db19741eff825dba9ab757`.

The bounded quote, public population and maintained-table workflows run in the
real desktop application. [Contracts and limits](research-workflows.md) define
the supported scope; this is not an arbitrary document/web engine or a production
release. No live model/provider request, private-source query or credential change
was made. The public adapter was tested live; HTTP failure fixtures are labeled.

## Environment and commands

Windows x64; Node 24.13.1/npm 11.8.0; resolved Electron 43.7.6; existing Rust/Cargo
1.93.0/MSVC spreadsheet toolchain. SQLite is the existing Node builtin, with an
experimental warning in Node 24. No application dependency or lockfile changes.

Normal launch remains `npm run dev`. Built verification rebuilt main/preloads and
Sheets with `npm run build -w @genoffice/shell` and
`npm run build -w @genoffice/sheets`, then launched `electron apps/shell` through
Playwright `_electron` against isolated `INFOMONK_USER_DATA` profiles. Dev-server
URL overrides and `ELECTRON_RUN_AS_NODE` were removed; `GENOFFICE_LANG=en`,
`GENOFFICE_DEBUG_HOOKS=1`, `GENOFFICE_NO_SPARE_VIEW=1` enabled the inherited test seam.
The raw drivers/logs are ignored under `.task/infomonk`:

```powershell
node fixtures/infomonk/research/generate.mjs
npm run test -w @genoffice/shell -- research.test.ts clean-table.test.ts workspace-store.test.ts
npm run typecheck
npm run test -w @genoffice/shell
npm run test -w @genoffice/sheets
npm run lint
npm run format:check
npm run check:theme-colors
npm run check:english-comments
npm run licenses
node .task/infomonk/research-acceptance.mjs
node .task/infomonk/research-refresh.mjs
node .task/infomonk/research-editor.mjs
```

Raw retained native results and exact live URLs/hashes:
[research-verification-results.json](research-verification-results.json).
No captured native window is a composed mockup. Electron `desktopCapturer`
captures the actual BrowserWindow together with its hosted native editor views.

## Checks

| Check                                                                | Result                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Focused research + prior cleanup/workspace regressions               | **26 passed**: 19 research, 7 prior cases                                                          |
| Type checks                                                          | All 26 workspace type checks passed; affected Shell/Sheets rechecked after final domain/UI changes |
| Shell/Sheets builds                                                  | Passed; actual built renderer/main/preload launch                                                  |
| Lint                                                                 | 0 errors; 12 inherited warnings                                                                    |
| Format, semantic themes, English comments, licenses, diff whitespace | Passed                                                                                             |
| Shell complete suite                                                 | **805 passed, 19 failed, 3 skipped**; same known Windows failures as baseline                      |
| Sheets TS complete suite                                             | **3,339 passed, 2 failed, 1 skipped**; same atomic-writer chmod assumptions on Windows             |
| Native Rust suite in Sheets test command                             | **235 library + 7 executable = 242 passed**, zero failures                                         |
| New native acceptance                                                | **17 checks passed**, including live acquisition and explicit failure/recovery fixtures            |

Shell failures remain default-app Windows basename (1), file-index/folder-tree
symlink assumptions (2) and headless-export POSIX path fixtures (16). These tests
were not weakened or masked. The inherited full root test sequence's Windows
electron-utils failures remain recorded in the [Stage 1–2 verification](verification.md).
No new feature failure was left among them. The later correction/schema/rollback/
rate-limit changes were verified by focused tests and affected-package checks.

## Native results

1. PDF sample extracts Q-100, total 125.5; “PDF page 1, line 6” resolves `Total: 125.50`.
2. Full PDF/DOCX/Markdown batch reports 3/3 complete, two quotes and two related
   items. The duplicate business key is retained once; missing total/date remain
   visible. Reviewed publication creates accepted revision 1.
3. Actual cell E2 in the native Quotes sheet resolves to the immutable PDF
   snapshot/locator; opening the source uses the inherited PDF viewer.
4. Reviewer correction 130 with a reason survives an idempotent full refresh;
   added/changed/absent counts are all zero and the accepted value stays manual.
5. A 15-minute schedule persists and pauses.
6. Structure copy contains no source IDs, country scope, parent records or accepted data.
7. Live World Bank collection retrieves 18 observations (six countries, 2022–2024),
   validates two pages and resolves field JSON pointers against retained bytes.
8. Mixed-source enrichment preserves the internal manual value and attaches
   external population/year through reviewed exact country codes.
9. Fresh process preserves accepted revision 3, correction 130 and paused schedule.
10. Injected HTTP 403 fails retrieval and retains all 18 accepted public records.
11. Injected pending HTTP acquisition is cancelled without publication.
12. Application interruption marks active work resumable/failed; explicit retry
    completes a new candidate while the accepted revision remains intact.
13. Updated inputs produce added 1, changed 3, absent 1 (including related item
    source-version changes). Reviewed removal replaces Q-200 with Q-300; Q-100's
    manual total 130 persists despite a source total 150.
14. A due timestamp is advanced in the isolated test database; the real app-open
    timer queues one run and stops at review, leaving accepted revision 4 unchanged.
15. Native cell edit to 135, undo/redo and save retain research ZIP metadata.
    Details warns; the accepted ledger remains 130.
16. Export copies the active owned research XLSX byte-for-byte, including evidence;
    it does not export the project's initial blank workbook.

17. Final built restart verifies the edited 135 value against manual accepted 130, the override warning and immutable source total 150 through the inherited metered ZIP inflation gate.

The focused suite additionally checks exact DOCX body/table/cell locators, invalid
dates, conflicting totals, failed document coverage, row dedupe, typed literal IDs,
normalized accepted cells, database migration/restart, transaction rollback,
configuration/revision/cancellation fences, deletion policy, source-hash diffs,
one-page web samples and durable retry after a second-page failure. Retry requests
only the missing page; earlier response bytes and original field metadata persist.
429 backoff is tested, including long Retry-After values that stop execution and
ask for a later retry instead of violating the provider's wait.

## Screenshots

- [Quote sample and exact evidence](research-screenshots/quote-sample-evidence-light.png)
- [Published quotes with visible missing facts](research-screenshots/quote-accepted-light.png)
- [Native sheet cell evidence](research-screenshots/sheet-cell-evidence-light.png)
- [Workflow history and paused schedule](research-screenshots/workflow-history-light.png)
- [Live bounded public population table](research-screenshots/worldbank-live-light.png)
- [Enrichment in dark theme](research-screenshots/enrichment-dark.png)
- [Edited-cell warning in dark theme](research-screenshots/sheet-edited-warning-dark.png)

The first six show the initial accepted/research journeys; the last shows a later
native edited projection. Schema/table IDs, values, missing reasons and activity
are actual results. Source corpus is synthetic; public observations are attributed.

## Limits

Only Windows desktop execution is verified. Provider/auth/cloud behavior,
installers and other operating systems remain unverified. The UI is currently
English. PDF evidence has page/content-order line locators, without bounding-box
highlighting or auto-scroll. Arbitrary document families/OCR and generic websites
are outside scope. Native cell edits do not silently modify accepted data, and
header/worksheet/helper mutation lacks automatic identity reconciliation.
Schedulers require an open app; no off-computer execution is promised. Snapshots,
revisions, unreferenced interrupted files and previews have no automatic pruning.
The isolated [parser comparison](parser-comparison.md) retains its PDF optional-
dependency blocker instead of claiming an unexecuted quality benchmark.
