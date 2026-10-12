# Infomonk implemented UI specification

Updated 11 October 2026. Stages 1–5 are implemented in the GenOffice Electron
shell. [Actual screenshots](implementation/verification.md#screenshots) show
executed native windows; [baseline screenshots](audit/verification.md) are historical.

Workflows and research Details have the implemented behavior described in
[Stages 3–5 journeys](implementation/research-workflows.md), with
[actual research screenshots](implementation/research-verification.md).

## Research and refresh states (Stages 3–5)

- Sources → Build a table from sources opens Workflows. Task, input snapshots,
  typed schema and row meaning are explicit; fixed extraction rules are shown.
- Workflow cards show actual input/configuration, accepted revision, destination,
  trigger, latest result and pending review. Run sample/full, Edit, History,
  structure copy, Update schedule and pause/resume operate on persistent records.
- Saved quote workflows show Input readiness. Check input readiness reads all
  confirmed snapshots and displays selected/unique/ready/review/blocked/copy counts,
  snapshot hashes, Quote IDs, bounded findings and expandable actual excerpts.
  Open checked snapshot uses the existing native source viewer. Edit confirmed
  inputs opens configuration; unsaved edits disable checking/running. A blocked
  check disables full execution and names the repair/exclusion path. Samples
  remain diagnostic. A source/configuration change marks the check outdated;
  full execution checks again in main. No input is silently excluded or repaired.
- A sample is visibly non-publishable. Candidate status/progress/coverage,
  missing/conflicting cells, related sheets and execution/validation events are
  real stored results. Tables show their complete count and first 100 rows.
  Run all confirmed inputs advances a completed sample directly, retaining it in
  history. Buttons and guidance distinguish a running task, a full pending review
  and an empty scope. A copied project starts at its workflow/input confirmation.
- Cell inspection shows value/origin, prior accepted value, missing reason,
  source version, locator and excerpt. Snapshot verification resolves the hash
  and locator; native viewers open a copy. Source values do not override manual
  corrections silently.
  Record keys are inspectable but have no ordinary correction form. Invalid
  negative numeric facts, malformed country/currency codes and invalid dates
  cannot create an accepted correction revision.
- Added/changed/absent counts use stable keys and content hashes. Absent records
  can be inspected; retain is the default. Publication requires a full completed
  run and review, and is blocked by failed coverage or missing/conflicting Quote
  IDs. Reviewed removal preserves
  overridden records together with their quote and related line items.
- Details in an accepted research workbook resolves the top-left selected cell.
  A changed sheet value/revision produces an explicit warning. Reload checks
  again after edits. Corrections are recorded in the accepted-table inspector.
- Refresh opens workflow controls. Accepted XLSX outputs are visible in Outputs.
  Export copies the active owned XLSX; cleanup remains scoped to the primary
  project workbook. Schedules state that Infomonk must be open and that publication
  always requires review; paused schedules show their actual state.
- World Bank scope/access requirements and exact-code enrichment are shown before
  collection. Internal/external/manual values are distinguished. No arbitrary
  search, scrape, OCR or hidden provider action is implied.
- Home shows accepted rows across related tables, pending review candidates,
  missing/invalid accepted facts, active runs and changed configuration/inputs.
  Needs review includes those actual review conditions; Review table opens the
  relevant candidate or unresolved accepted table.
- Workflow freshness shows accepted time and saved-input changes. Public data
  carries its acquisition time; the UI does not claim live remote freshness.
  A stale local-input candidate explains why publication is blocked.
- Sources → Update snapshot selects a new version, retaining old hashes and
  Open previous actions. Accepted values stay unchanged until reviewed refresh.
- Needs review within a table applies to the complete table before paging. Counts
  distinguish matching rows from all rows. Corrections may remove resolved rows
  from the filter without losing their manual origin.

## Navigation and state

The Bermuda jobs task confirms BMA, Coralisle and Expertise Group before public
acquisition. Its default tracker shows role/source/employer context, location,
closing date, listing observation, application status and notes. Show all job
fields exposes keys, source URLs and first/last-seen/check times; the XLSX retains
all fields. Open live listing resolves a trusted stored source route. Personal
status uses a controlled choice and notes use the persistent tracking action;
source facts are read-only. Refresh job listings fetches again and stops for
review. Missing listings stay visible as not found, without a closure claim.
See the [executed jobs journey](use-cases/bermuda-jobs-2026-10-11.md).

| Location                      | Implemented behavior                                                                                       | Boundary                                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Home / Projects               | Recent activity, actual research state, Needs review, star/search/sort, New project and Review table       | Ledger counts include related tables; public freshness is acquisition evidence                                               |
| Shared project creation       | Goal, file/link, CSV/TSV preview and explicit start intent                                                 | Extract from files opens Sources; Research the web opens the supported population task; extraction/retrieval remain explicit |
| Sheets                        | Opens remembered owned XLSX in inherited Univer; native ribbon, formulas, editing and save                 | Primary workbook remains the cleanup input; sources/previews are excluded from remembered selection                          |
| Sources                       | Current immutable snapshots, hash/time, Update snapshot, previous versions and native copies               | Updating a snapshot does not update accepted data; registered links are reference-only                                       |
| Workflows                     | Confirmed task/schema/scope, sample/full run, review, correction, history, refresh and app-open scheduling | Bounded quote family and public adapter; publication always requires review                                                  |
| Outputs / Create              | Current/earlier accepted revisions and saved supporting native outputs                                     | At most 100 accepted revisions displayed, total count shown; supporting editors/writers reused                               |
| Activity                      | Project events merged with real run/publication/correction entries and workflow links                      | Up to 100 displayed entries; paged run history remains available separately                                                  |
| Connections                   | Existing provider/account access and explicit empty state for new integrations                             | Genspark account remains labeled Genspark; no Infomonk authentication invented                                               |
| Local files / Settings / Help | Inherited file browser and actual settings/help                                                            | Upstream help and secondary editor wording remain partly upstream                                                            |

Empty/unavailable states describe unsupported extraction families, arbitrary web
research and new connectors accurately. A blank starter workbook remains useful
for native work, but file extraction starts at source confirmation instead.
Opening an older revision explicitly remembers that owned file; the current
ledger revision remains labeled separately in Outputs.

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
shows saved origin references or accepted research evidence when available, and
honest empty states otherwise. Source previews open native
editor tabs. Cleanup profile exposes original record references for its first
eight data rows, explicitly labeled as a sample; statistical counts cover the
whole chosen saved range.

No model reply was fabricated or requested. Actual provider-dependent conversation
and authentication paths remain unverified. The workspace stays useful through
local controls. New sheet panel identity uses the original Infomonk mark;
secondary editors retain upstream panel/ribbon identities for now.

A cold spreadsheet view remains inert with its opening indicator until both the
initial range and Univer startup are ready. Name-box navigation cannot run against
unregistered scroll render modules. Prewarmed views retain their existing path.
See [the native workspace use case](testing/workspace-flow-2026-10-10.md).
The [readiness screenshots](testing/input-readiness-2026-10-11.md) show actual
blocked light-theme inputs and a repaired dark-theme batch.

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
Close returns to the actual workbook editor. The cleanup input filename is shown;
when it differs from the remembered working workbook, a notice names both and
points research corrections/refresh to Workflows.

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

The initial Bermuda jobs expansion listed 19 supported public sites with Select all and Clear
selection controls. It explains title-rule matching, adjacent roles, partial
search coverage and uncollected targets. Jobs uses 100-row paging with personal
status/notes beside role, location, deadline and listing observation. Additional
fields expose role group, scope limitations, publication expiry and advertiser.
Source checks includes all 43 current targets; uncollected counts and dates are
null. Run completion refers to configured acquisition bounds, not whole-site
coverage. JSON evidence is inspected as stored text in both workflow and native
Sheets Details. Employer facts cannot be edited through personal tracking.

The current iteration expands that source selector to 26 public sources and exposes
the full 78-target coverage table with uncollected counts left blank. Whole-table
search, role/source/status/availability filters and sorting submit together; named
views survive restart and shortlist actions create personal tracking updates.
Refresh summaries show changed vacancy facts separately from new check times.

Website tables start with a public HTTPS page or saved HTML source, discovery,
row counts, preview, headers and explicit unique keys. Source context is visible
before publication. Switching tasks, workflows or source versions invalidates
pending discovery. Native sheets display readable HTML headings while evidence
retains canonical identities. Unsupported layouts and failed refreshes explain
their bounds and retain accepted data.
Completed review runs have an explicit Review candidate action. Reselecting the
same run reloads its preview and clears old cell-inspection state; it never
silently publishes a candidate or changes accepted records.

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

## UI/UX gate before the harness — 12 October

The owner's current order is UI/UX acceptance followed directly by the engineering
harness. Broader source coverage, templates, localization and release work remain
separate later work.

Job views keep quick presets, search, role group and source selection visible.
Tracking status, availability and sorting sit under More filters and sorting;
active secondary criteria open that section. Presets announce their applied state
and are not highlighted while the separate review filter is active. Changed
draft filters show an Apply view reminder. Select controls have stable names.

Source checks use compact source/hostname, local display date, matching count,
recorded scope and expandable details. Partial, bounded, retained and unsearched
checks remain distinct. Null counts display Not checked. Full recorded scope,
exact URL and timestamp remain available. The source search explicitly covers the
loaded page; summary counts describe loaded data. A target is not a distinct
company, and a bounded check is not exhaustive coverage.

Cell selection focuses and reveals the details panel. It uses readable field
names and shows excerpts/issues immediately; hashes, locators and record IDs sit
under expandable details. Close returns to the originating cell. A saved tracking
change waits for the table to update and controls to enable before returning
focus; if the current view removes the row, focus returns to the table heading.
Go to table and Review and publish make long workflow pages easier to navigate.
Table headers remain visible inside their scroll area; unnecessary row paging
controls are omitted when there is one page.

Below 1,000px the workspace navigation collapses to named icon controls, retaining
Settings and Help. Long project names, source actions and output actions wrap.
The project dialog contains Tab/Shift+Tab focus, restores focus on dismissal,
keeps its actions visible and announces pending file reads. A new selection clears
old preview rows immediately; pending/failed reads block creation. HTML setup
announces readiness, provides source guidance, exposes mixed header confirmation
and labels table previews and unsupported-layout explanations.

The [native UI/UX review](testing/ui-ux-2026-10-12.md) records actual screenshots,
commands, regression results and limits. Keyboard/layout checks do not constitute
a formal accessibility audit or a human usability study.
