# Infomonk hardening review — 10 October 2026

The six [readiness findings](pre-stage-6-2026-10-10.md) are addressed in this
milestone. Supported Stages 1–5 remain local and bounded. Stage 6 has preparation
inputs and gates; generated-code execution remains disabled. `assay.md` was excluded.

## Result and source connections

| Finding                                             | Implemented result                                                                                                                                    | Evidence                                                                                                                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unbounded history polling                           | Indexed 20-run summaries and complete latest-workflow cards; serialized polling and stale-response protection                                         | `ResearchStore.history/latest`, `ResearchService.state`, ResearchPanel; summary SQL tested without calling the full-run reader; real native history page 2 exercised |
| Truncated table visibility / full evidence payloads | 100-row candidate/accepted pages with totals and evidence counts; full cell and prior-value lookup on demand; separate server-calculated absent pages | `pages.ts`, detail/cell/absent IPC; unit page/absence tests; native 205-item workflow inspected/corrected item 151 and reached final five rows                       |
| Writer/reader evidence mismatch                     | Shared 16,777,216-character serialization gate before XLSX generation and accepted publication/correction                                             | `metadata.ts`, projection/service/store; oversized attempted writes preserve revision, accepted cells and corrections                                                |
| Non-portable recovery                               | Closed-profile CLI, consistent SQLite backup, owned-path relocation and restart-safe migration                                                        | `workspace-portability.ts`, `tools/workspace-backup.mjs`; unit/native restore with original folder moved out of reach; actual reopened sheet source inspection       |
| Missing project-from-template journey               | New independent project and blank workbook retaining task/schema/notes; clears sources, countries and parent references                               | ProjectCreator, Workspace, ResearchService.createFrom; unit/native UI tests show no old records, runs, schedules or corrections                                      |
| Missing next-stage contract                         | Invoice pattern, independently authored expected cases, private/local defaults and disabled execution/cost gates                                      | [Preparation contract](../implementation/stage-6-preparation.md), frozen policy and exact expected-locator tests                                                     |
| Missing hosted checkpoint                           | Tested implementation and earlier regression fixes committed and synchronized on `codex/infomonk-workspace`                                           | [Implementation branch](https://github.com/Kal-Tech-Bda/genoffice/tree/codex/infomonk-workspace); Git synchronization checked after committing                       |

## Measured history improvement

The built Electron shell used the **same synthetic profile** as the preflight
measurement: 100 published histories, each with one quote and 1,000 line items.
Three sequential shell/preload/main IPC calls returned 20 summary records,
total count 100, and no candidate/event/diff payloads.

| Metric               | Before                            | After                                                            |
| -------------------- | --------------------------------- | ---------------------------------------------------------------- |
| Median native IPC    | 40,373.5 ms                       | 24.0 ms                                                          |
| Samples              | 40,129.7 / 40,449.5 / 40,373.5 ms | 24.0 / 23.7 / 24.9 ms                                            |
| Serialized state     | ~151 MiB                          | 9,497 characters                                                 |
| Selected-run preview | Whole datasets for every history  | One selected run; 100 of 1,000 items; 51,673 characters, 30.8 ms |

These are read/IPC diagnostics, not extraction accuracy or maximum-capacity
certification. Selected detail still parses and diffs one complete stored candidate
in main; one-cell evidence retrieves trusted data rather than a renderer-supplied
file path. The main process measured 277.7 MiB RSS in this diagnostic. Raw samples
are in [performance.json](hardening-2026-10-10/performance.json).

## Tests and review

| Check                                             | Executed result                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Shell production build                            | Passed; rebuilt after final main/preload changes                                            |
| Root type checks                                  | All 26 workspaces passed; Shell rechecked for the final change                              |
| Focused cleanup/workspace/research tests          | 35 passed across five files; nine new hardening tests included                              |
| Full Shell suite                                  | 814 passed, 19 failed, 3 skipped                                                            |
| Full Sheets TypeScript suite                      | 3,339 passed, 2 failed, 1 skipped                                                           |
| Native Sheets Rust suite                          | 242 passed, 0 failed                                                                        |
| Selected Electron regressions                     | 18 passed, 0 failed, no retries/skips; final two hardening cases rerun after restore review |
| Lint                                              | 0 errors; same 12 inherited warnings; changed source/tests checked without warnings         |
| Format/theme/English-comments/license/diff checks | Passed; dependency locks unchanged                                                          |

The 21 full-suite failures match the prior Windows baseline: Shell's Linux desktop
basename assertion, two symlink privilege cases and 16 POSIX headless-path cases;
Sheets' two `chmod` write-denial simulations. Their test files remain unchanged
from the upstream base. The complete suites are therefore **not all green**.

Review traced authorization/ownership, publication fences, evidence identity,
async UI context, root relocation, crash recovery and source/destination locking.
It fixed these additional issues before handoff:

- Startup and backup now acquire the same maintenance lock before session/closed
  checks. Destination staging remains locked through relocation.
- Restored schedules and active/queued attempts are fenced in staging before
  rename, preventing a crash from accidentally resuming restored automation.
- Migration preserves the old-root marker until all stores finish. An injected
  broken input JSON demonstrated that repair/retry completes idempotently.
- Evidence lookup fetches a matching trusted input instead of loading every
  historical input; relocation iterates durable input records.
- Busy workflow/history controls and request guards prevent late cell/context
  results from entering another selection. The two prior stale-review bugs have
  permanent Electron regression tests included in this checkpoint.

The first new paging test used an exact button name that omitted the existing
“Manual override” indicator. It failed despite the correct saved value; the
assertion was corrected and the complete Electron selection passed. No product
behavior was altered to bypass a test. Actual native capture review found usable
light/dark workspace and restored-sheet evidence states.

## Reproduction and limits

Windows `10.0.26200` x64, Node `24.13.1`, npm `11.8.0`, Electron `43.7.6`,
Playwright `1.62.1`. Scratch profiles and synthetic documents were used. The native
restore test uses the actual backup CLI, moves only its own scratch source folder,
launches the restored profile and resolves Details evidence in a real Sheets view.
No provider/model/account request, private user-profile migration, framework
installation or dependency upgrade was performed.

```powershell
npm run build -w @genoffice/shell
npm run typecheck
npm run test -w @genoffice/shell
npm run test -w @genoffice/sheets
npm run lint
npm run format:check
npm run check:theme-colors
npm run check:english-comments
npm run licenses
$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
npm run test:e2e -- infomonk-hardening.spec.ts infomonk-research-context.spec.ts sheets-edit-save.spec.ts sheets-open-tsv.spec.ts sheets-csv-inplace-save.spec.ts sheets-csv-export.spec.ts sheets-filter-reopen.spec.ts sheets-find-replace.spec.ts ai-panel-side-settings.spec.ts theme-pipeline.spec.ts open-empty-file-save.spec.ts
```

Ignored drivers/logs are retained in `.task/hardening-20261010/` and
`.task/hardening-*.log`. Results and hashes are in
[results.json](hardening-2026-10-10/results.json). Backup usage and retry behavior
are in [workspace recovery](../implementation/workspace-recovery.md).

Remaining work is broader document/web coverage, unrestricted sheet-identity
reconciliation, retention, enforced Stage 6 isolation and live provider evaluation,
localization, installer/release checks and other platforms. These are documented
roadmap/verification limits. They are not claimed completed by this hardening turn.

Actual native captures:

- [Paged accepted correction, light](hardening-2026-10-10/paged-correction-light.png)
- [Independent template workflow, dark](hardening-2026-10-10/independent-template-dark.png)
- [Restored sheet evidence, light](hardening-2026-10-10/restored-sheet-evidence-light.png)
