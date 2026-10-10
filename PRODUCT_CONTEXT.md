# Infomonk product context

Updated 9 October 2026. Stages 0–2 are implemented locally on the GenOffice fork.
Stages 3–8 remain the ordered roadmap.

Infomonk is an AI research and data intelligence workspace that builds, verifies
and maintains structured tables from documents and the web. The current runnable
milestone provides project organization and a real local spreadsheet cleanup
journey. Document extraction, web acquisition and maintained datasets are future
capabilities; registering a source does not perform them.

## Owner decisions and scope

- Keep GenOffice's Electron desktop architecture, embedded Univer, native office
  editors, provider configuration and existing Codex bridge.
- Sheets are primary. Documents, slides, PDF, Markdown and HTML are supporting
  viewers and secondary outputs, reachable through Create and Local files.
- The owner initially approved an audit only, then authorized completing Stages
  1–2 first. The attached build prompt supplies product context; direct user
  scope controls execution. `assay.md` remains excluded.
- Windows is the executed platform. Local work must remain useful without paid
  APIs. No provider request or credential change was required for this milestone.
- Preserve original files, licenses, notices, history, internal package names and
  committed dependency versions. No new processing framework was installed.

## Runnable behavior

Projects support creation from a goal, file or registered URL, rename, description,
star, search, sorting and reopening. A project owns a working workbook and source
snapshots; opening a source uses a separate native preview copy. Home, Projects,
Sheets, Sources, Workflows, Outputs, Activity, Connections and Settings are in the
real desktop shell. Workflow scheduling and new connections have honest empty
states. Source Refresh is unavailable.

CSV/TSV import has a delimiter/sample preview. Clean table inspects the complete
chosen saved sheet/range, previews trimming, chosen number/date normalization,
column renaming, blank-row removal, keyed deduplication and sorting, then creates
a separate XLSX. Missing values and leading-zero identifiers survive. Supported
flat rows carry stable source record IDs through cleanup and native full-row
sorting. Direct formulas, undo/redo, filters, save and export use inherited editors.

Source record references identify a saved workbook version, worksheet and original
row. They are not verified evidence for current cell values or document facts.
Human edits, copied rows, deleted helper IDs and arbitrary agent mutations need
the accepted-data/evidence contracts planned for Stage 3. Details states this gap.

## Inherited capabilities that prevent duplicate work

Reuse the native view/tab router, full spreadsheet command surface, file writers,
CSV/TSV parser, atomic-save helper, project/chat storage, original-file preservation,
secondary editors, assistant streaming/cancellation/attachments and provider stack.
The code and evidence map is [docs/reuse-map.md](docs/reuse-map.md).

Do not add another spreadsheet grid, separate office editor, generic agent loop
or parallel project/chat database. Existing search indexing, chat history and A1
links do not supply immutable field evidence or maintained dataset revisions.

See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md),
[ARCHITECTURE.md](ARCHITECTURE.md) and
[the implementation verification](docs/implementation/verification.md).
