# Infomonk Stage 1–2 verification

Executed 9 October 2026 on Windows x64. Upstream base:
`1ca5e9adfc1807a158db19741eff825dba9ab757`. Branch:
`codex/infomonk-workspace`. See the [manifest](../upstream-manifest.md) for history,
versions and remotes; the [Stage 0 record](../audit/verification.md) remains historical.

## Result

The real Electron workspace builds and runs. Project creation, metadata,
source previews, native spreadsheet editing, cleanup, sorting, save/export,
restart/reopen and previous-version restore were exercised. No model request was
sent. This is the Stages 1–2 local milestone, not a production or full-roadmap release.

## Environment and launch

Windows x64; Node 24.13.1, npm 11.8.0, Rust/Cargo 1.93.0, MSVC toolchain;
resolved Electron 43.7.6, React 19.2.7, Univer 0.25.1. The root recommends Node 22
and requires >=22.12. Dependencies were installed with `npm ci`; both lockfiles,
root licenses/notices and `ee/` are unchanged.

```powershell
npm ci
npm run fixtures
npm run fixtures -w @genoffice/sheets
npm run build:all
npm run dev
```

An isolated profile can be set with
`$env:INFOMONK_USER_DATA = Join-Path (Get-Location).Path '.task/infomonk/dev-userdata'`.
The root dev route starts Vite renderers on 5173–5178 and shell on 5199 plus
Electron. Acceptance drivers used isolated profiles, English UI, debug hooks and
no spare view. Native dialogs were stubbed only to select synthetic input/output
paths; actual filesystem writes and native editors ran. A separate fresh Electron
process proved persistence. Final cleanup/restart verification also used built
renderers (`file:///.../shell/out/renderer/index.html`, `genoffice://sheets/`),
with all renderer URL environment overrides removed.

On-demand scripts and raw logs are retained under ignored `.task/infomonk/`;
they are deliberately not CI test files. The sanitized
[verification-results.json](verification-results.json) records outcomes.

## Commands and outcomes

| Check                                                     | Final outcome                                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build:all`                                       | Pass: all editor/CLI/shell builds and native release sidecar. Shell rebuilt after final cleanup guards; Sheets rebuilt after live Details selection fix.                                                      |
| `npm run typecheck`                                       | Pass: all 26 workspaces. Changed shell and Sheets rechecked after final guards/selection fix.                                                                                                                 |
| `npm run format:check`                                    | Pass for changed/new files.                                                                                                                                                                                   |
| `npm run lint`                                            | Pass: zero errors, 12 inherited warnings. Ignored `.task` acceptance drivers excluded consistently with Git.                                                                                                  |
| `npm run check:theme-colors`                              | Pass: new chrome uses semantic/app tokens.                                                                                                                                                                    |
| `npm run check:english-comments`                          | Pass.                                                                                                                                                                                                         |
| `npm run licenses`                                        | Pass production npm allowlist. No new dependencies; native cargo-deny not run.                                                                                                                                |
| `npm test`                                                | Stops at inherited electron-utils Windows failures: 254 pass, 3 fail; i18n 26 pass before it. Other relevant suites run directly below.                                                                       |
| ProjectStore unit suite                                   | 120 pass, 1 skip.                                                                                                                                                                                             |
| XLSX gateway unit suite                                   | 248 pass.                                                                                                                                                                                                     |
| Shell unit suite                                          | 786 pass, 19 fail, 3 skip. The 19 failures match the baseline files: default-app 1, file-index-scan symlink 1, folder-tree symlink 1, headless-export POSIX paths 16.                                         |
| Sheets TypeScript suite (`npx vitest run` in apps/sheets) | 3,339 pass, 2 fail, 1 skip. Both failures are inherited Windows chmod/atomic-recovery fixture assumptions.                                                                                                    |
| `npm run native:test -w @genoffice/sheets`                | Pass: 235 library + 7 executable tests, 0 doc tests. The earlier Stage 0 Application Control blocker did not recur on this attempt; no host policy was changed. Cause of that difference was not established. |
| Focused cleanup/workspace/record-guard tests              | 9 pass across 3 files; part of the shell/sheets totals, not additional aggregate tests.                                                                                                                       |
| Formula fixture verification                              | Pass: C7 retains `=SUM(C2:C6)`, one formula counted, row-changing cleanup guarded.                                                                                                                            |
| Selected inherited Electron regression tests              | 10 pass, zero skips/failures in effective final results. See details below.                                                                                                                                   |
| New desktop acceptance                                    | 19 checks: 13 project/cleanup/editor checks, 2 fresh-process restore checks, 4 source/layout/output/activity checks.                                                                                          |

The first changed shell run exposed six expected old `GenOffice` Home-title
assertions and one intermittent update-resume timing failure under concurrent
suite load. Title expectations now reflect Infomonk; the focused 79-case tab/update
rerun passed, then the full shell rerun returned to precisely the 19 inherited
failures. Product updater behavior was not altered to make that timing test pass.

The first selected Electron run passed nine cases and stopped the filter case at
the intentionally replaced `.quick-card` Home entry. The test now enters the
retained native quick-create route through Local files; its full filter/save/reopen/
unhide scenario then passed. These effective results combine the nine unchanged
passing cases and the final filter rerun, without double-counting earlier attempts.
Other old Home-only expectations are outside this selected suite; the new desktop
acceptance covers the replacement project Home.

## Inherited Electron checks

```powershell
$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
npm run test:e2e -- sheets-edit-save.spec.ts sheets-open-tsv.spec.ts sheets-csv-inplace-save.spec.ts sheets-csv-export.spec.ts sheets-filter-reopen.spec.ts ai-panel-side-settings.spec.ts theme-pipeline.spec.ts --reporter=json
```

Git's `unzip` is needed by inherited XLSX assertions on this Windows machine.
Cases cover actual cell edit/save/reopen, TSV parsing, CSV blank-line/import/save,
CSV export/formula warning/Save As, filter criteria and hidden-row restoration,
assistant side/resize/collapse/draft persistence, and theme propagation/restart.
The assistant side case exercises Docs; new acceptance separately exercises the
modified Sheets assistant and Details modes.

## New desktop evidence

- Create a real project from supplier TSV with delimiter/sample preview.
- Rename, star, search/filter and restart with stored metadata intact.
- Preserve the mounted sheet and unsent assistant draft across project sections,
  Assistant/Details and resize/collapse; show selected A2:D4 context.
- Register immutable local DOCX/PDF snapshots; open separate native preview copies.
- Profile the entire saved range. Preview/discard trimming, chosen-key dedupe,
  blank removal, stable sorting and explicit date policy; discarded input unchanged.
- Apply five supplier records to three. Amount total changes from 35 to 25;
  `001` stays text; Gamma's amount stays missing; invalid date remains unchanged.
  The original TSV stays byte-identical and cleanup creates a separate XLSX.
- Block native partial-column sorts on managed records. Native complete-row sort
  moves helper IDs with data; Gamma retains original row 6 after native save.
- Enter `=SUM(C2:C4)` directly, compute 25, native undo/redo and save. Reopen in
  a fresh process with formula/value, original row references and metadata intact.
- Export the actual saved XLSX. Restore preceding primary workbook and swap back.
- Match 64 px navigation/native x=64, y=96 at 900 px window width; retain visible
  project context and collapse the assistant to keep the sheet useful.
- Create a document through inherited editor, type synthetic content, native Save
  As into the project folder and discover/open it in Outputs. Activity lists real
  metadata events. Workflow/connection empties and disabled Refresh are truthful.

Selection-scope/selection-ask/record-guard regression subset: 32 passed after the
live selection fix. Details reads selection operation updates separately from
the assistant’s frozen request scope; its A2:D4 display was asserted in both
initial and fresh-process built-renderer runs.

Focused units additionally cover header renaming, leading-zero conversion refusal,
strict valid/invalid dates, out-of-range numeric-date rejection, 1904-date rejection,
missing-key retention, repeated sorting/source IDs, formula/style/untouched-part
preservation, named-range/advanced/unsupported-row-layout guards, no new IDs on unsupported complex
sheets, stale-preview rejection, discard and source snapshot/view-copy isolation.

## Screenshots

These are actual native window captures via Electron desktopCapturer, including
WebContentsViews. Shell-only capturePage does not include native editor views, so
its incomplete diagnostics were removed. Images show synthetic data; screenshots
are not composed mockups. Larger source captures retain upstream secondary chrome.

| State                                  | Screenshot                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| First-use home, light                  | [Home](screenshots/home-first-light.png)                                                     |
| Returning project home, light/dark     | [Light](screenshots/home-returning-light.png), [dark](screenshots/home-returning-dark.png)   |
| Shared project creation/import         | [Creation](screenshots/project-create-light.png)                                             |
| Source registrations                   | [Sources](screenshots/sources-light.png)                                                     |
| Saved-range profile                    | [Profile](screenshots/cleanup-profile-light.png)                                             |
| Real before/after preview              | [Preview](screenshots/cleanup-preview-light.png)                                             |
| Native sheet and assistant, light/dark | [Light](screenshots/sheet-assistant-light.png), [dark](screenshots/sheet-assistant-dark.png) |
| Selected range Details                 | [Details](screenshots/sheet-details-light.png)                                               |
| Fresh-process saved workbook           | [Reopened](screenshots/sheet-reopened-light.png)                                             |
| Native PDF source                      | [PDF](screenshots/source-pdf-light.png)                                                      |
| Narrow sheet/navigation                | [Narrow](screenshots/sheet-narrow-light.png)                                                 |
| Saved secondary output                 | [Outputs](screenshots/outputs-light.png)                                                     |
| Real project metadata activity         | [Activity](screenshots/activity-light.png)                                                   |

## Limits and next boundary

See [feature-status.md](feature-status.md) for precise support. Cleanup uses saved
files, 32 MiB/100,000-cell bounds and conservative row guards. Record origins are
not evidence for edited values; arbitrary helper copying/deletion/other agent
mutations require future identity reconciliation. XLSX retains origins; CSV loses
package metadata. Source retention and new-copy localization remain incomplete.
Physical OS file drops, live providers/auth/cloud, installers and non-Windows
execution were not tested. Baseline Docs protection and other unrelated upstream
failures were not fixed. No dependency advisory was silently upgraded away.

[IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md) specifies Stage 3: one
predictable quote-document family, measured parser comparison, transactional
accepted data, source locators and persistent corrections. Stages 3–8 remain deferred.
