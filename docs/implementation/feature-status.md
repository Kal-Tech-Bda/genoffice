# Infomonk feature status (Stages 1–2)

Updated 9 October 2026. Evidence levels are **runtime-tested**, **unit-tested** and
**source-confirmed**. A source trace or enabled button alone is not runtime proof.

| Area                                                  | Status / evidence                                                                                | Main implementation                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Project create/import/open/rename/star/search         | Runtime-tested; metadata persists after restart                                                  | `Workspace.tsx`, `ProjectCreator.tsx`, `workspace-store.ts`, reused ProjectStore       |
| Goal/document/URL starts                              | Source-confirmed: create blank real workbook and register inputs; source add/view runtime-tested | Shared creation and source gateway; no extraction/fetch claim                          |
| CSV/TSV delimiter and sample preview                  | Runtime-tested                                                                                   | Reused `xlsx-gateway/gateway/csv-import`                                               |
| Saved sheet/range/header profile                      | Runtime-tested and unit-tested; counts cover complete chosen saved range; samples labeled        | `clean-table.ts`, `CleanupFlow.tsx`                                                    |
| Trim, chosen date/number policy, column rename        | Unit-tested; trim and date policy runtime-tested; invalid/ambiguous values remain with warning   | Deterministic rule plan and inherited narrow XLSX patch                                |
| Blank removal, chosen-key dedupe, stable sort         | Runtime-tested; five rows to three, 35 total to 25; missing keys/values preserved                | Flat-table cleanup; complete worksheet/headers required                                |
| Preview/discard/apply                                 | Runtime-tested and unit-tested; stale saved SHA rejected, new file written                       | WorkspaceStore token/version boundary                                                  |
| Previous version                                      | Runtime-tested; primary pointer swaps with preceding workbook and back                           | WorkspaceStore; distinct from native cell undo                                         |
| Record origins                                        | Runtime-tested through native full-row sort, save/restart; unit-tested guards                    | Hidden helper ID and linked XLSX metadata; original saved workbook SHA/sheet/row       |
| Formulas/styles/untouched parts                       | Unit-tested cleanup preservation; native formula/save/reopen runtime-tested                      | Inherited gateway/sidecar; row cleanup blocked for formulas or advanced structures     |
| Native sheet editing/undo/filter/CSV export           | Runtime-tested; selected inherited Electron cases pass                                           | Existing Univer, journal, sidecar and writers                                          |
| XLSX project export                                   | Runtime-tested; copies actual saved primary workbook                                             | Workspace IPC/native SaveDialog; native CSV exports retain their inherited limitations |
| Assistant/Details, selected range, resize/collapse    | Runtime-tested; unsent draft preserved                                                           | Existing assistant kept mounted; new Details mode                                      |
| Source DOCX/PDF viewers                               | Runtime-tested; immutable source plus separate preview copy                                      | Existing native editors                                                                |
| Create/Outputs/Activity                               | Runtime-tested for document creation/save, discovery and actual metadata activity                | Existing editor factories and project-owned supporting files                           |
| Light/dark/system theme                               | Light/dark screenshot evidence; inherited theme pipeline runtime-tested                          | Shared semantic tokens plus Infomonk tokens                                            |
| Narrow navigation                                     | Runtime-tested at 900 px; collapsed 64 px nav and matching native bounds                         | Workspace CSS and TabManager                                                           |
| Real OS file drop                                     | Source-confirmed trusted native drop seam; physical OS drop unverified                           | Shell preload `webUtils.getPathForFile`                                                |
| Providers/Codex bridge/auth/cloud                     | Inherited source paths retained; live credentialed behavior unverified                           | Existing provider/agent/account modules                                                |
| Document/web extraction, cell evidence, review issues | Deferred; honest empty/unavailable states                                                        | Stage 3/4 plan                                                                         |
| Workflows, refresh, schedules, new connectors         | Deferred; Refresh disabled and details explain availability                                      | Stage 5 plan                                                                           |
| Installer/cross-platform release                      | Configuration/assets present; packaging and non-Windows runtime unverified                       | Fork app ID, identity, analytics/update configuration                                  |

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
