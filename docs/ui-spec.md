# Infomonk implemented UI specification

Updated 9 October 2026. Stages 1–2 are implemented in the GenOffice Electron
shell. [Actual screenshots](implementation/verification.md#screenshots) show
executed native windows; [baseline screenshots](audit/verification.md) are historical.

## Navigation and state

| Location                      | Implemented behavior                                                                                          | Boundary                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Home / Projects               | First-use and returning states; recent activity, star filter, search, name/recent sorting, New project        | Activity time derives from persisted metadata, chat activity and saved workbook mtime; no fabricated freshness/review count |
| Shared project creation       | Goal, suggested name, file picker/native file-drop seam, URL, CSV/TSV delimiter and first-six-row preview     | Goal/URL/document starts a blank real workbook with sources; no automatic extraction or web collection                      |
| Sheets                        | Opens primary XLSX directly in inherited Univer; native ribbon, formula bar, worksheet tabs, editing and save | One primary workbook per project; native file tabs remain separate                                                          |
| Sources                       | File snapshots with hash, registered links and native preview tabs                                            | Previews are copies; links open externally and are not retrieved snapshots                                                  |
| Workflows                     | Honest unavailable detail explaining future repeat/update support                                             | No scheduler, sample success or fake run history                                                                            |
| Outputs / Create              | Document, slides, Markdown, HTML and PDF creation through inherited editors; opens saved supporting outputs   | List discovers project-bound files and supported outputs saved directly in the owned workspace folder                       |
| Activity                      | Persisted project creation, rename/star/source/cleanup/version changes                                        | Metadata activity, not a maintained-dataset audit ledger                                                                    |
| Connections                   | Existing provider/account access and explicit empty state for new integrations                                | Genspark account remains labeled Genspark; no Infomonk authentication invented                                              |
| Local files / Settings / Help | Inherited file browser and actual settings/help                                                               | Upstream help and secondary editor wording remain partly upstream                                                           |

No extraction, evidence, Needs review filter, workflow schedule or connector state
masquerades as implemented. A sample adapter was unnecessary: ordinary empty
states describe the unavailable functionality. Review issues become a real badge/
filter only when Stage 3 persists them.

## Native workspace geometry

The shell owns a 40 px top document-tab strip, 224 px navigation and a 56 px project
toolbar. Main-process `TabManager.setWorkspaceInsets` moves the active native
WebContentsView to x=224, y=96. Below 1000 px width, project navigation collapses
to 64 px and native bounds match. Project name remains in the toolbar. Home or
project section navigation hides the editor without disposing the view. Detached
editors retain inherited standalone layout. HTML full screen keeps its inherited
whole-window behavior.

`AppFrame.tsx`, `infomonk/Workspace.tsx` and `tab-manager.ts` implement this seam.
Plain shell DOM cannot overlay an editor view; new project sections activate Home
and preserve the mounted workbook. Unowned native files keep their native layout.

## Assistant and Details

The inherited chat remains mounted while Assistant/Details switch. Composer,
selection quote, attachments, existing resize/collapse preferences and streaming
infrastructure are reused. Details displays current selected-range context and
states that verified source evidence is unavailable. Source previews open native
editor tabs. Cleanup profile exposes original record references for its first
eight data rows, explicitly labeled as a sample; statistical counts cover the
whole chosen saved range.

No model reply was fabricated or requested. Actual provider-dependent conversation
and authentication paths remain unverified. The workspace stays useful through
local controls. New sheet panel identity uses the original Infomonk mark;
secondary editors retain upstream panel/ribbon identities for now.

## Cleanup interaction

Inspect a saved worksheet and explicit A1 range, confirm header handling, then
review column counts, missing cells, numeric totals and formula count. Column
names, formats and duplicate keys are editable. Only explicit date policies and
strict number conversion are supported. Missing key rows are retained; duplicate
matching is case/type sensitive and keeps the first record.

Preview shows input/output row counts, changed retained values, duplicate and blank
removals, warnings and before/after samples. Dates render human-readable previews.
Discard writes nothing. Apply creates a separate named cleaned XLSX, then opens it
in Univer. Previous workbook version swaps the primary pointer with the preceding
file and can swap back. Native cell undo/redo is separate. Original sources survive.

Row-changing cleanup requires the entire A1 used worksheet, headers and a supported
flat sheet. Any formula anywhere in the workbook or unsupported advanced sheet
structures blocks row changes. Scalar cleanup leaves formulas intact. Limits are
32 MiB per input and 100,000 cells per chosen range/import. Saved-file SHA invalidates
stale previews. Native save comes before cleanup/export; unsaved editor state is
not silently merged into a cleanup result.

The hidden `_infomonk_record_id` column travels with managed rows. Native partial
column sorting is blocked; include the ID column in a data-only sort or use Clean
table. Assistant sort proposals for managed tables are rejected before expansion.
Other manual/agent operations are not a field-evidence or correction ledger.

## Tokens and accessibility

`infomonk/workspace.css` defines restrained forest accents, warm light canvas and
charcoal dark canvas with system-theme fallback. Shared semantic tokens supply
surfaces, text, borders, hover, danger and overlay colors. App tokens cover spacing,
typography, control/panel radii, modal elevation and density. Native workbook content
and export colors remain authored data. Original mark assets are in `apps/shell/build`.

Controls use visible keyboard focus, native buttons/inputs, accessible labels,
selected/disabled/error states and reduced-motion rules. Creation supports keyboard
input and Escape dismissal; inherited keyboard shortcuts remain. New workspace
copy is centralized in `en.ts` with English fallback; full new-copy localization
is deferred. This milestone does not claim a formal accessibility certification.
