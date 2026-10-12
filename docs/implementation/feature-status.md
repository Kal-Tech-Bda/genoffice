# Infomonk feature status

Updated 11 October 2026. Evidence levels are **runtime-tested**, **unit-tested** and
**source-confirmed**. A source trace or enabled button alone is not runtime proof.

The [expanded jobs check](../use-cases/bermuda-jobs-wide-2026-10-11.md) supersedes
the narrow three-site pilot: 19 registered public sources, pagination, explicit
partial coverage, 24 uncollected targets, source-listing tracking and immutable
HTML/JSON evidence. See its manifest for executed Windows tests and exact counts.

Stages 3–5 now implement the bounded research behaviors below; the Stage 1–2
table following it retains the earlier milestone's evidence.

The [process journey review](../testing/process-journeys-2026-10-11.md) adds native
mixed-source failure/conflict review, direct sample-to-full, independent workflow
reuse and CSV cleanup. Queue rollback/schedule fences, correction identity/validation
and protected parent/child retention have focused unit coverage. Record keys are
read-only in the ledger correction UI. Saved local quote input readiness is now
implemented and [native-tested](../testing/input-readiness-2026-10-11.md). General
document understanding and source-backed report generation remain gaps; the
engineering harness remains last/disabled.

| Area                                                      | Status                                                                                                                                                | Main paths                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Quote schema/sample/batch extraction and related items    | Runtime-tested PDF/DOCX; simple table/cell locators unit-tested; unsupported families fail visibly                                                    | `research/extract.ts`, ResearchPanel                     |
| Saved quote input readiness                               | Native mixed-batch repair, stale-check rejection and full IPC block; parser reuse, integrity and item disagreements unit-tested                       | `research/readiness.ts`, ResearchService, InputReadiness |
| Candidate business-key publication fence                  | Native repaired key publication; unit-tested missing-key rejection in service and direct store commit; no historic rewrite                            | ResearchStore prepare/publish                            |
| Bermuda jobs and personal tracking                        | Live three-site collection, manual refresh, shortlist persistence and native evidence after restart; synthetic failed-source/disappearance regression | `research/jobs.ts`, existing ledger, ResearchPanel       |
| Cell evidence / immutable snapshot inspection             | Runtime-tested native sheet → PDF and exact locator; typed text IDs regression-tested                                                                 | EvidenceDetails, research service/projection/IPC         |
| Accepted values, missing facts, corrections and revisions | Runtime-tested restart and correction-preserving refresh; transactional rollback/revision fences unit-tested                                          | ResearchStore schema 2                                   |
| World Bank bounded live collection                        | Runtime-tested: 18 observations, 2 pages; structured snapshots and pointers; null/scope/rate limits unit-tested                                       | `research/worldbank.ts`                                  |
| Mixed internal/public enrichment                          | Runtime-tested exact country-code matching and internal/manual/external origins                                                                       | ResearchService enrichment                               |
| Workflows, refresh, diffs and copy structure              | Runtime-tested versioned workflows, idempotent refresh and copies without inputs/records                                                              | ResearchPanel / SQLite queue                             |
| Retry/cancel/interruption and retrieval failures          | Native injected HTTP fixtures distinguish errors and preserve accepted data; unit coverage/fences                                                     | ResearchStore / ResearchService                          |
| Schedules                                                 | Persistent local app-open scheduling; always stop at review; no hosted/off-computer execution                                                         | Same authoritative SQLite queue                          |

Full guarantees, native evidence and remaining limits:
[research contracts](research-workflows.md), [verification](research-verification.md).

Hardening verified after that milestone:

| Area                        | Status                                                                                                                  | Main paths                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| History and table paging    | Native 100-run history: 24 ms median IPC, 20 summaries; 100-row table pages and full evidence on demand                 | ResearchStore history/latest, pages, ResearchPanel |
| Evidence size compatibility | Unit-tested oversized publication/correction rejection preserves accepted data                                          | metadata, projection, ledger                       |
| Portable recovery           | Unit/native backup restore with original unavailable; reopened sheet resolves evidence; migration retry tested          | workspace-portability, backup CLI                  |
| New project from workflow   | Native UI-tested independent project; no prior inputs, history, records, schedule or overrides                          | ProjectCreator / ResearchService                   |
| Future engineering contract | Independent text corpus and frozen defaults; generated execution/private cloud requests disabled; no runner/model claim | engineering-policy, engineering fixtures           |

See [hardening review and results](../testing/hardening-2026-10-10.md).

Workspace flow validation adds:

| Area                                          | Status / evidence                                                                                     | Main paths                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Contextual file/public starts                 | Native UI-tested; file route opens Sources, web route defaults to the supported task                  | ProjectCreator / Workspace / startKind                      |
| Home review/freshness and full-table filter   | Native missing-fact correction journey; cross-page filter unit-tested                                 | ResearchService summaries/freshness / pages / ResearchPanel |
| Source updates and old versions               | Native TXT/PDF update journey; immutable history and stale publish fences unit-tested                 | WorkspaceStore / queue inputs / ResearchService             |
| Remembered accepted/selected workbook         | Native save/export/restart verified; source previews rejected; restore paths unit-tested              | workingWorkbook / workspace IPC / portability               |
| Current/earlier outputs and research activity | Native revision/correction entries and workflow links verified                                        | ResearchService overview / Workspace                        |
| Cold sheet startup                            | Loading guard waits for render initialization; native name-box editing and cold/spare opens exercised | Sheets App lifecycle                                        |

The [supplier comparison report](../testing/workspace-flow-2026-10-10.md) records
the independent expected facts and native checks. The engineering harness remains
disabled and will be implemented last.

| Area                                                  | Status / evidence                                                                              | Main implementation                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Project create/import/open/rename/star/search         | Runtime-tested; metadata persists after restart                                                | `Workspace.tsx`, `ProjectCreator.tsx`, `workspace-store.ts`, reused ProjectStore       |
| Goal/document/URL starts                              | Runtime-tested creation and contextual route; goal starts a real blank workbook                | Shared creation and source gateway; extraction/retrieval explicitly confirmed          |
| CSV/TSV delimiter and sample preview                  | Runtime-tested                                                                                 | Reused `xlsx-gateway/gateway/csv-import`                                               |
| Saved sheet/range/header profile                      | Runtime-tested and unit-tested; counts cover complete chosen saved range; samples labeled      | `clean-table.ts`, `CleanupFlow.tsx`                                                    |
| Trim, chosen date/number policy, column rename        | Unit-tested; trim and date policy runtime-tested; invalid/ambiguous values remain with warning | Deterministic rule plan and inherited narrow XLSX patch                                |
| Blank removal, chosen-key dedupe, stable sort         | Runtime-tested; five rows to three, 35 total to 25; missing keys/values preserved              | Flat-table cleanup; complete worksheet/headers required                                |
| Preview/discard/apply                                 | Runtime-tested and unit-tested; stale saved SHA rejected, new file written                     | WorkspaceStore token/version boundary                                                  |
| Previous version                                      | Runtime-tested; primary pointer swaps with preceding workbook and back                         | WorkspaceStore; distinct from native cell undo                                         |
| Record origins                                        | Runtime-tested through native full-row sort, save/restart; unit-tested guards                  | Hidden helper ID and linked XLSX metadata; original saved workbook SHA/sheet/row       |
| Formulas/styles/untouched parts                       | Unit-tested cleanup preservation; native formula/save/reopen runtime-tested                    | Inherited gateway/sidecar; row cleanup blocked for formulas or advanced structures     |
| Native sheet editing/undo/filter/CSV export           | Runtime-tested; selected inherited Electron cases pass                                         | Existing Univer, journal, sidecar and writers                                          |
| XLSX project export                                   | Runtime-tested; copies active saved owned XLSX, falling back to remembered workbook            | Workspace IPC/native SaveDialog; native CSV exports retain their inherited limitations |
| Assistant/Details, selected range, resize/collapse    | Runtime-tested; unsent draft preserved                                                         | Existing assistant kept mounted; new Details mode                                      |
| Source DOCX/PDF viewers                               | Runtime-tested; immutable source plus separate preview copy                                    | Existing native editors                                                                |
| Create/Outputs/Activity                               | Runtime-tested for document creation/save, discovery and actual metadata activity              | Existing editor factories and project-owned supporting files                           |
| Light/dark/system theme                               | Light/dark screenshot evidence; inherited theme pipeline runtime-tested                        | Shared semantic tokens plus Infomonk tokens                                            |
| Narrow navigation                                     | Runtime-tested at 900 px; collapsed 64 px nav and matching native bounds                       | Workspace CSS and TabManager                                                           |
| Real OS file drop                                     | Source-confirmed trusted native drop seam; physical OS drop unverified                         | Shell preload `webUtils.getPathForFile`                                                |
| Providers/Codex bridge/auth/cloud                     | Inherited source paths retained; live credentialed behavior unverified                         | Existing provider/agent/account modules                                                |
| Document/web extraction, cell evidence, review issues | Implemented within the current quote/public family; see research table above                   | ResearchService / immutable snapshots / accepted ledger                                |
| Workflows, refresh and schedules                      | Implemented local app-open queue; new arbitrary connectors remain unavailable                  | ResearchService / SQLite / ResearchPanel                                               |
| Installer/cross-platform release                      | Configuration/assets present; packaging and non-Windows runtime unverified                     | Fork app ID, identity, analytics/update configuration                                  |

## Practical limits

- Cleanup reads the **saved** primary workbook. Save native edits before inspecting,
  applying cleanup or exporting. No unsaved editor/file merge is claimed.
- Supported project starts: XLSX, CSV, TSV, DOCX, PDF, Markdown/text or goal/link.
  Legacy formats remain accessible in Local files but are not cleanup inputs.
- Inputs are at most 32 MiB; imports/chosen ranges at most 100,000 cells. Profiles
  are not viewport estimates. Samples are not full processing results.
- Row-changing cleanup rejects formula-bearing workbooks, partial/headerless ranges,
  named ranges, protection, tables, filters, validation, comments, drawings and
  other advanced structures. Scalar changes preserve formulas. 1904-date workbooks
  cannot use date normalization. Unusual unsupported package structures may reject
  before writing; originals remain intact.
- New durable record IDs are added only to supported complete flat tables. Origin
  links do not validate current edited cell values. Native partial sorts and
  assistant managed-sort proposals are blocked. Arbitrary copying/editing/deleting
  IDs or other agent operations have no correction/evidence ledger yet.
- Export workbook retains XLSX provenance. Inherited CSV export loses package
  metadata and may include the helper column. Use XLSX to retain origin links.
- New workspace copy is English; existing editor locales remain. Some inherited ribbon icons and secondary
  editor/account/help branding remain. Source snapshots and preview copies
  have no automatic retention policy. No production release is claimed.

See [verification](verification.md), [UI specification](../ui-spec.md) and
[the Stage 3 plan](../../IMPLEMENTATION_PLAN.md).
