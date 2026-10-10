# Workspace accuracy and supplier comparison — 10 October 2026

This increment connects the workspace to real maintained-table state and validates
a complete supported-family use case in the built Windows application. The owner
requires the engineering harness to be **last**; generated execution remains
disabled. `assay.md` was excluded. No dependency upgrade, new framework, paid
provider request or credential change was needed.

## Features and reviewed boundaries

| Gap                                                            | Implemented behavior                                                                                                                                                       | Source / verification                                                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| All starts opened a blank workbook                             | File extraction starts at Sources; web starts at the supported public task; shared creation remains                                                                        | ProjectCreator, Workspace, `startKind`; native creation cases                                         |
| Reopen returned the starter instead of a published table       | Published/selected owned XLSX becomes `workingWorkbook`; default reopen and export fallback use it; cleanup retains its primary input                                      | WorkspaceStore / workspace IPC / ResearchService; native save/export/restart, restore tests           |
| No source update/version journey                               | Update snapshot retains logical source ID and immutable previous versions; Open previous verifies old bytes and opens a separate copy                                      | WorkspaceStore; unit version/integrity/relocation checks and native update flow                       |
| Queued inputs could change before execution                    | Queue transaction pins all confirmed local input versions; retry/execution reuse pinned references; publication checks current content before projection and before commit | ResearchStore / ResearchService; blocked queue, duplicate-byte scope and late-update tests            |
| Home did not expose research review state                      | SQL-backed accepted rows across tables, pending reviews, unresolved facts, active runs and changed inputs; Review table links to the applicable workflow/run               | ResearchService summaries/freshness and Workspace; native missing-fact and changed-input journey      |
| Review required scanning unfiltered pages                      | Needs review filters missing values/validation issues across the whole table before paging; matching/all counts are explicit                                               | `pages.ts` / ResearchPanel; 230-row cross-page test and native correction                             |
| Outputs/activity omitted maintained-table history              | Current/earlier accepted revisions and real publication/correction events; links open actual workflows/runs                                                                | ResearchService overview / Workspace; native output/activity assertions                               |
| Cold name-box navigation rejected before renderer registration | Existing opening guard remains inert until Univer startup reaches Steady; subscription is disposed on finish/unmount                                                       | Sheets App; renderer error reproduced, fixed and checked through native editing plus cold/spare opens |

Summaries do not parse historical candidate JSON. Outputs display the latest 100
accepted revision files with total count; research activity combines recent events
and corrections into 50 entries, and Workspace merges at most 100 displayed events.
Run history remains separately paged. Previous snapshots are retained without an
automatic pruning policy. Windows case variations cannot turn a source/preview
into the working workbook. Recent-project time includes the remembered workbook's
saved modification time.

Public freshness means saved acquisition time/configuration/parent state; it does
not claim that a remote service has not changed. Updating an external original on
disk is not automatically watched: Update snapshot explicitly imports its new bytes.
Native edits to an accepted XLSX remain file edits; persistent research corrections
use the ledger UI and keep their manual origin.

## Independently expected use case

All names and documents are synthetic. The hand-authored
[`expected.json`](../../fixtures/infomonk/workspace-flow/expected.json) supplies
business facts independently of extraction. The generator only packages text
into DOCX/PDF, using the existing JSZip dependency.

The user compares three quotes for five packs of paper in CAD. Each document
contains one quote and one related item. Missing payable totals must remain null;
quantity × unit price is not evidence of a payable total.

| Quote                          | Initial document fact | After correction | Updated incoming fact | After reviewed refresh |
| ------------------------------ | --------------------: | ---------------: | --------------------: | ---------------------: |
| Northwind Q-N001, TXT          |                   100 |              100 |                   120 |                    120 |
| Cedar Q-C001, DOCX             |                    90 |               90 |                    90 |                     90 |
| Maple Q-M001, PDF → TXT update |               Missing |      108, manual |                   115 |            108, manual |

The executed flow creates a file-start project, adds DOCX/PDF sources, confirms
the quote schema/scope, runs a one-input sample and verifies that it cannot publish.
Full processing produces three quotes plus three related items. The table filter
and Home review link find Maple's missing total. The synthetic reviewer records
108 with an explicit reason; the resolved row leaves Needs review.

Two source updates retain previous versions and leave accepted totals unchanged.
Home flags changed inputs. Reviewed refresh updates Northwind to 120 and preserves
Maple's manual 108 beside the incoming evidence `Total: 115.00`. Outputs identifies
revision 3 as current and earlier revisions separately; Activity includes the
publication, source updates and correction.

The native spreadsheet receives H1 `Lowest accepted quote (CAD)` and H2
`=MIN(E2:E4)`. Its independent expected result is 90. Save writes the formula into
the actual owned XLSX; project export is byte-identical to that saved workbook.
A fresh Electron process reopens the remembered revision, retains the formula,
and Details resolves E4 to manual 108 with verified current-source evidence 115.
All eight recorded checkpoints passed, with no captured renderer page errors.
Exact TXT/DOCX/PDF total locators are also checked against independent expectations.

A separate manual Windows UI pass opened the project from Home, inspected Sources
history and opened Maple's previous PDF in the inherited native viewer. The original
still shows a blank `Total:` while the current accepted sheet shows the reviewer
override. This also caught adjacent hash/time labels in Sources; they now occupy
separate lines. The rebuilt renderer was visually checked again.

Fixtures and manual reproduction steps:
[workspace-flow README](../../fixtures/infomonk/workspace-flow/README.md).
Native result record: [use-case-results.json](workspace-flow-2026-10-10/use-case-results.json).

## Executed checks

| Check                                        | Result                                                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| Shell and Sheets production builds           | Passed; committed dependency versions/native engine retained                  |
| Type checks                                  | All 26 workspaces passed; final Shell/Sheets checks repeated                  |
| Focused cleanup/workspace/research tests     | 40 passed across six files, including five new use-case/accuracy tests        |
| Full Shell suite                             | 819 passed, 19 failed, 3 skipped                                              |
| Full Sheets TypeScript suite                 | 3,339 passed, 2 failed, 1 skipped                                             |
| Native Sheets Rust tests                     | 242 passed, 0 failed                                                          |
| ProjectStore suite                           | 120 passed, 1 skipped                                                         |
| Selected Electron cases                      | 22 passed, 0 failed, no retries/skips                                         |
| Lint                                         | 0 errors, same 12 inherited warnings                                          |
| Format/theme/English-comments/license checks | Passed                                                                        |
| 100-run native IPC diagnostic                | 22.9 ms median; 20 summaries, 9,728 serialized characters, no full candidates |

The 21 full-suite failures are inherited Windows compatibility/privilege cases:
Shell Linux basename comparison (1), symlink privileges (2), POSIX headless paths
(16), and Sheets chmod write-denial assumptions (2). Their failure files remain
unchanged from upstream. They are not hidden or counted as passing.

The first new end-to-end attempt used the focus hook incorrectly in its test helper.
After fixing that helper, the longer flow revealed the real scroll-controller error.
The product loading guard fixes that error. Existing desktop tests that acted after
fixed startup delays now wait for `aria-busy=false`; Find waits for the actual final
fixture cell rather than an incidental status message. Business/save/filter/evidence
assertions remain intact. A full regression rerun confirms those changes.

The IPC diagnostic uses the same synthetic 100-run/1,000-item-per-run profile as
the preceding hardening check. Samples were 26.9 / 22.9 / 22.8 ms; selected detail
returned 100 of 1,000 item rows in 33.3 ms. This is a read/IPC diagnostic, not an
extraction accuracy or capacity certification. Raw measurements are in
[performance.json](workspace-flow-2026-10-10/performance.json).

## Commands and environment

Windows x64 10.0.26200; Node 24.13.1; npm 11.8.0; Electron 43.7.6;
Playwright 1.62.1; inherited Rust/Cargo 1.93.0/MSVC engine. Normal development
remains `npm run dev`. Verification launches built Electron against isolated
profiles, removes development URL overrides and `ELECTRON_RUN_AS_NODE`, and uses
English plus the existing explicit debug hook. The spare-open test enables the
real prewarmed view. Native file pickers select synthetic fixtures; the extractor,
renderer, save writer and persistence are real application code.

```powershell
node fixtures/infomonk/workspace-flow/generate.mjs
npm run build -w @genoffice/shell
npm run build -w @genoffice/sheets
npm run typecheck
npm run test -w @genoffice/shell -- clean-table.test.ts research.test.ts research-hardening.test.ts workspace-store.test.ts workspace-portability.test.ts workspace-flow.test.ts
npm run test -w @genoffice/shell
npm run test -w @genoffice/sheets
npm run test -w @genoffice/project-store
npm run test:e2e -- infomonk-workspace-flow.spec.ts infomonk-hardening.spec.ts infomonk-research-context.spec.ts sheets-edit-save.spec.ts sheets-open-tsv.spec.ts sheets-csv-inplace-save.spec.ts sheets-csv-export.spec.ts sheets-filter-reopen.spec.ts sheets-find-replace.spec.ts ai-panel-side-settings.spec.ts theme-pipeline.spec.ts open-empty-file-save.spec.ts open-focus-typing.spec.ts
npm run lint
npm run format:check
npm run check:theme-colors
npm run check:english-comments
npm run licenses
```

Ignored drivers/logs are retained under `.task/workspace-flow-20261010/`.
[Results/hashes](workspace-flow-2026-10-10/results.json) connect verification to
the tested source. The hosted implementation branch remains
[`codex/infomonk-workspace`](https://github.com/Kal-Tech-Bda/genoffice/tree/codex/infomonk-workspace).

## Native visual evidence

These are full-window captures, including the actual Electron editor views.

- [Missing-fact review, light](workspace-flow-2026-10-10/missing-facts-review-light.png)
- [Home changed-input state, light](workspace-flow-2026-10-10/home-inputs-changed-light.png)
- [Saved comparison sheet, dark](workspace-flow-2026-10-10/comparison-sheet-dark.png)
- [Fresh-process manual/current evidence, dark](workspace-flow-2026-10-10/reopened-manual-evidence-dark.png)
- [Retained original PDF, manual native check](workspace-flow-2026-10-10/manual-original-pdf-dark.png)
- [Source history, manual native check](workspace-flow-2026-10-10/manual-source-versions-dark.png)

## Remaining order and limits

Continue table-to-output usability, measured input coverage and validation before
the engineering harness. The deterministic quote family, one bounded public
adapter, local app-open schedules and explicit ledger corrections remain the
supported scope. Generic web research, OCR, broader document semantics, unrestricted
sheet identity reconciliation, retention, localization, credentialed providers,
installers, teams and other platforms remain pending. The harness must reuse the
accepted-data/evidence/review contracts and be implemented last.
