# GenOffice baseline verification

Executed 9 October 2026, on Windows x64, from upstream
`1ca5e9adfc1807a158db19741eff825dba9ab757`.
This is the historical, unmodified Stage 0 baseline. At that point only audit
documents/screenshots were added. Subsequent Stages 1–2 changes and current test
results are recorded in [implementation verification](../implementation/verification.md).

## Result

**The desktop app builds and runs.** The development walkthrough and fresh-process
workbook reopen passed. Selected Electron tests: **16 passed, 2 failed**.
Effective TypeScript/unit results across all 26 workspaces: **17,665
passed, 59 failed, 50 skipped**. These totals count
one final result per workspace: configured HTML-to-DOCX rerun replaces its initial
missing-browser run; Sheets TypeScript tests are separate from the blocked native
test command. The additional focused Docs rerun is not counted twice.

Failures are inherited baseline results or environment/test limitations. They
are not regressions from Infomonk changes, because product source and lockfiles
were unchanged. Passing paths do not establish every Office-file compatibility
case, advanced command, provider, source extraction or production deployment.

## Commands and observed outcomes

| Command / check                                                   | Outcome                                                                                                                                                              |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                          | Passed; lockfile unchanged; 1,056 packages installed.                                                                                                                |
| `npm run fixtures`                                                | Passed; committed document fixtures unchanged.                                                                                                                       |
| `npm run fixtures -w @genoffice/sheets`                           | Passed; generated six synthetic workbook fixtures in an ignored directory.                                                                                           |
| `npm run build:all`                                               | Passed; all seven apps, CLI and Rust release sidecar built.                                                                                                          |
| `npm run typecheck`                                               | Passed across all workspaces.                                                                                                                                        |
| `npm run lint`                                                    | Passed with 0 errors and 12 inherited warnings.                                                                                                                      |
| `npm run licenses`                                                | Passed production npm allowlist. Native cargo-deny/optional-model licensing not executed.                                                                            |
| `npm test`                                                        | Stopped at electron-utils: 3 failed, 254 passed. Remaining workspace test commands were then run separately.                                                         |
| `npm run test -w <workspace>` for remaining workspaces            | All attempted, including failing suites; final results below.                                                                                                        |
| `npm run test -w @genoffice/html2docx` with `CHROME_PATH`         | Passed, 110 tests; initial run could not auto-discover Chrome on Windows.                                                                                            |
| `npm run test -w @genoffice/docs -- tests/protect-dialog.test.ts` | Focused repeat reproduced the same failure: 7 passed, 1 failed.                                                                                                      |
| `npm run test -w @genoffice/sheets`                               | Native debug build blocked before TypeScript tests by Windows Application Control, error 4551.                                                                       |
| `npx vitest run` from `apps/sheets`                               | Independent TypeScript checks: 3,337 passed, 2 failed, 1 skipped.                                                                                                    |
| `npm run compat -w @genoffice/sheets`                             | Passed all five preservation fixtures; no unexpected modified entries.                                                                                               |
| `npm run benchmark -w @genoffice/sheets`                          | Passed; one cell mutation in a synthetic 50,000-cell archive took 143.02 ms; process max RSS 150,948 KB. This measures gateway mutation, not interactive grid scale. |
| `npm audit --json`                                                | Reported 14 inherited advisories: 8 moderate, 6 high; includes development/build dependencies. Reachability was not assessed and no audit fix ran.                   |
| `npm run dev`                                                     | Started six renderer servers and the real Electron shell; runtime walkthrough captured below.                                                                        |

## Workspace unit-test results

`npm run format:check` and `npm run check:english-comments` also passed after the
audit documents were added.

| Workspace                   | Passed | Failed | Skipped | Final result               |
| --------------------------- | -----: | -----: | ------: | -------------------------- |
| `@genoffice/i18n`           |     26 |      0 |       0 | Pass                       |
| `@genoffice/electron-utils` |    254 |      3 |       0 | Fail                       |
| `@genoffice/font-metrics`   |     25 |      0 |       0 | Pass                       |
| `@genoffice/zip-gate`       |      9 |      0 |       0 | Pass                       |
| `@genoffice/docx-engine`    |   1708 |      0 |       1 | Pass                       |
| `@genoffice/pdf2docx`       |    815 |      0 |       7 | Pass                       |
| `@genoffice/html2docx`      |    110 |      0 |       0 | Pass                       |
| `@genoffice/file-parse`     |    124 |      0 |       0 | Pass                       |
| `@genoffice/pptx-engine`    |   1236 |      0 |      17 | Pass                       |
| `@genoffice/xlsx-gateway`   |    248 |      0 |       0 | Pass                       |
| `@genoffice/pptx-ops`       |     68 |      0 |       0 | Pass                       |
| `@genoffice/pptx-render`    |    386 |      0 |       0 | Pass                       |
| `@genoffice/pipelines`      |     77 |      0 |       0 | Pass                       |
| `@genoffice/ai-search`      |    177 |      4 |       0 | Fail                       |
| `@genoffice/agent-core`     |    166 |      0 |       0 | Pass                       |
| `@genoffice/ai-provider`    |    417 |      1 |       0 | Fail                       |
| `@genoffice/project-store`  |    120 |      0 |       1 | Pass                       |
| `@genoffice/cli`            |    400 |     27 |       3 | Fail                       |
| `@genoffice/ui`             |    124 |      0 |       0 | Pass                       |
| `@genoffice/docs`           |   3443 |      1 |       0 | Fail                       |
| `@genoffice/sheets`         |   3337 |      2 |       1 | Fail; native tests blocked |
| `@genoffice/shell`          |    779 |     19 |       3 | Fail                       |
| `@genoffice/slides`         |   1413 |      0 |      14 | Pass                       |
| `@genoffice/pdf`            |    890 |      1 |       0 | Fail                       |
| `@genoffice/markdown`       |    990 |      1 |       2 | Fail                       |
| `@genoffice/html`           |    323 |      0 |       1 | Pass                       |

## Inherited failures and environmental limits

| Area                | Observed failure                                                                                                                               | Classification / consequence                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| electron-utils      | Two dialog-memory POSIX path expectations and a chmod-based unwritable-folder fixture.                                                         | Windows path/permission assumptions. Do not call the root suite green.                                                                          |
| ai-search           | POSIX mode/path expectations and two symlink creation failures (EPERM).                                                                        | Windows test/environment limits; not a demonstrated live-auth/privacy regression.                                                               |
| ai-provider         | Test attempts to create a Windows path embedded inside a temporary pathname.                                                                   | Windows fixture ENOENT; the other 417 provider tests passed. Live providers remain unverified.                                                  |
| CLI                 | 27 failures involving launch/config/path/mode/symlink behavior; one unhandled named-pipe EADDRINUSE error also occurred.                       | Mixed Windows assumptions and integration limitations. Do not claim reliable Windows CLI/MCP end-to-end support from this run.                  |
| Docs                | Modify-password dialog test never reached the expected applied state. Focused repeat failed as well.                                           | Reproduced, unresolved baseline failure. Source parsing/editing and representative viewing are separate verified paths.                         |
| Sheets native tests | Generated zstd-sys debug build script was blocked by Windows Application Control (os error 4551).                                              | Environment blocker. The restriction was not disabled or bypassed; release sidecar build/run succeeded. Native test assertions did not execute. |
| Sheets TypeScript   | Two atomic-promotion recovery tests rely on chmod making a directory unwritable. The expected fallback did not run on this machine.            | Permission-fixture limitation; ordinary native save/reopen passed. Locked-file recovery itself remains unverified in Windows runtime.           |
| Shell               | 19 failures, principally POSIX headless paths, Linux default-app assumptions and unavailable symlink creation.                                 | Platform-specific test limits; source/runtime distinction retained.                                                                             |
| PDF                 | A test treats a backslash inside a proposed filename as a character to sanitize; Windows basename processing treats it as a separator.         | Path expectation difference; actual text-PDF rendering passed.                                                                                  |
| Markdown            | One export assertion checks a directory prefix using `/`.                                                                                      | Windows path expectation; no product source fix applied.                                                                                        |
| HTML-to-DOCX        | Initial Chrome discovery omitted Windows install paths.                                                                                        | Resolved by setting the supported CHROME_PATH variable; configured suite passed.                                                                |
| Electron folders    | Two tests expect the full Windows path as root display text because their basename logic splits only on `/`. UI displayed the actual basename. | Test portability failures before create/move/rename/delete; that whole lifecycle was not verified by these cases.                               |

The development log also recorded an inherited Univer duplicate-component warning
and a `SheetsScrollRenderController2` dependency error during an early audit
attempt. The final controlled walkthrough completed; those log messages were
not patched or presented as proof of correctness. Early local-driver timing and
target-selection errors were corrected in ignored audit tooling, not product code.

## Existing Electron journey tests

Executed command (Git's bundled unzip was added to this process PATH for tests
that inspect OOXML):

```powershell
$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
npm run test:e2e -- home.spec.ts home-search.spec.ts home-folders.spec.ts new-file-tab.spec.ts tab-middle-click-close.spec.ts sheets-edit-save.spec.ts sheets-open-tsv.spec.ts sheets-csv-inplace-save.spec.ts sheets-csv-export.spec.ts sheets-filter-reopen.spec.ts ai-panel-side-settings.spec.ts theme-pipeline.spec.ts --reporter=json
```

| Existing spec                     | Results            |
| --------------------------------- | ------------------ |
| `ai-panel-side-settings.spec.ts`  | 1 passed, 0 failed |
| `home-folders.spec.ts`            | 1 passed, 2 failed |
| `home-search.spec.ts`             | 1 passed, 0 failed |
| `home.spec.ts`                    | 2 passed, 0 failed |
| `new-file-tab.spec.ts`            | 1 passed, 0 failed |
| `sheets-csv-export.spec.ts`       | 3 passed, 0 failed |
| `sheets-csv-inplace-save.spec.ts` | 2 passed, 0 failed |
| `sheets-edit-save.spec.ts`        | 1 passed, 0 failed |
| `sheets-filter-reopen.spec.ts`    | 1 passed, 0 failed |
| `sheets-open-tsv.spec.ts`         | 1 passed, 0 failed |
| `tab-middle-click-close.spec.ts`  | 1 passed, 0 failed |
| `theme-pipeline.spec.ts`          | 1 passed, 0 failed |

Passing cases cover home/localization, content search, file-based creation,
middle-click close, CSV blank handling/in-place save/export/loss warning,
comma-heavy TSV, cell edit/save/new-process reopen, filter criteria restore,
assistant side/resize/collapse/draft persistence and theme persistence.

## Development walkthrough and fresh launch

The actual `npm run dev` application was inspected using existing debug hooks,
synthetic local files and a scratch userData directory. No model request was sent.

| Action                  | Independently checked outcome                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home and themes         | Real home captured in light and dark.                                                                                                                                                                  |
| Open workbook           | ID `001` stayed text; amounts were numeric; SUM(C2:C4) produced 25.                                                                                                                                    |
| Direct keyboard editing | Supplier changed from Alpha to Alpha revised.                                                                                                                                                          |
| Undo/redo               | One-step undo restored Alpha; redo restored Alpha revised in the controlled walkthrough.                                                                                                               |
| Enter formula           | Entered `=C3*2`; computed result was 30.                                                                                                                                                               |
| Assistant layout        | Width increased by approximately 60 px; collapse/expand preserved an unsent draft.                                                                                                                     |
| Save                    | Saved OOXML contained the edited text and new formula.                                                                                                                                                 |
| Source viewers and tabs | DOCX opened in the real Tiptap editor; a synthetic text PDF rendered; returning to Sheets retained data and draft.                                                                                     |
| Fresh-process reopen    | A separately launched Electron instance read ID `001`, Alpha revised, formula `=C3*2`, result 30 and total 25 from disk. Formula assertions waited for computation, not just the first streamed cells. |

Synthetic input expected values were defined in the local audit driver before
execution. These are ordinary workbook/viewer checks, not document-to-table
extraction or source-evidence validation. The temporary drivers and raw logs are
under ignored `.task/audit/`; no acceptance driver was added to CI or product code.
The durable machine-readable summary is
[verification-results.json](verification-results.json).

## Actual screenshots

These show the inherited GenOffice app, not an Infomonk mockup. All workbook and
PDF content is synthetic. Viewer screenshots are editor surfaces; they exclude
the separate shell tab-strip surface.

- [Home, light](screenshots/home-light.png)
- [Home, dark](screenshots/home-dark.png)
- [Sheet and assistant, light](screenshots/sheet-assistant-light.png)
- [Sheet and assistant, dark](screenshots/sheet-assistant-dark.png)
- [DOCX source, dark](screenshots/document-source-dark.png)
- [PDF source, dark](screenshots/pdf-source-dark.png)
- [Freshly reopened sheet, dark](screenshots/sheet-reopened-dark.png)

## Reproduction and limits

See [../upstream-manifest.md](../upstream-manifest.md) for exact installation,
build, development and isolated-profile commands. On Windows, HTML-to-DOCX tests
need `CHROME_PATH` set to the installed Chrome executable. Current local raw logs
and scripts remain available in `.task/audit/`, but they are intentionally not
portable tracked artifacts.

No live AI call, arbitrary document extraction, scheduled refresh,
cross-platform installer, Office-app fidelity comparison or production-security
claim is established. Unit suites include their own skipped cases (including
external-tool/format-dependent coverage); skipped tests are not passes. The npm
advisories, native test blocker and reproduced unresolved failures belong in the
baseline for future regression comparisons. The hosted fork was established
after the runtime audit; its parent, remotes and matching baseline revision were
verified separately. GitHub CLI authentication does not verify any AI provider.
