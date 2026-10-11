# Infomonk product context

Updated 10 October 2026. Stages 0–5 are implemented locally on the GenOffice fork
within bounded supported input/source families. The engineering harness remains
disabled and will be the final implementation phase, after workspace accuracy,
usable outputs and end-to-end validation.

Infomonk is an AI research and data intelligence workspace that builds, verifies
and maintains structured tables from documents and the web. The current runnable
milestone provides project organization, real spreadsheet cleanup, supplier-quote
extraction, a bounded World Bank adapter and reviewed maintained-table workflows.
Registering a source alone does not extract it: users confirm a task, schema and
scope, inspect a sample, process all inputs and review before publication.

## Owner decisions and scope

- Keep GenOffice's Electron desktop architecture, embedded Univer, native office
  editors, provider configuration and existing Codex bridge.
- Sheets are primary. Documents, slides, PDF, Markdown and HTML are supporting
  viewers and secondary outputs, reachable through Create and Local files.
- The owner initially approved an audit only, then authorized completing Stages
  1–2 first, then explicitly authorized Stages 3–5. The attached build prompt supplies product context; direct user
  scope controls execution. `assay.md` remains excluded.
- The owner then authorized further workspace features and use-case testing,
  explicitly placing the data engineering harness last. The original numbered
  roadmap does not override that order.
- Windows is the executed platform. Local work must remain useful without paid
  APIs. No provider request or credential change was required for this milestone.
- Preserve original files, licenses, notices, history, internal package names and
  committed dependency versions. No new application processing dependency was added.
  An isolated Unstructured parser comparison uses synthetic fixtures only.

## Runnable behavior

Projects support creation from a goal, file or registered URL, rename, description,
star, search, sorting and reopening. A project owns a working workbook and source
snapshots; opening a source uses a separate native preview copy. Home, Projects,
Sheets, Sources, Workflows, Outputs, Activity, Connections and Settings are in the
real desktop shell. Workflows perform bounded document extraction and public
population acquisition/enrichment; Refresh opens those controls. Schedules require
the open desktop application and always produce a candidate for review. New
arbitrary connections remain unavailable.

File starts lead to Sources; web starts lead to the supported public task.
Published tables and explicitly selected owned workbooks become the remembered
working workbook. Home reports actual accepted rows across tables, pending
reviews, missing facts, active runs and changed inputs. Review links open the
relevant candidate or accepted table; a full-table Needs review filter finds
missing/invalid facts beyond the first page.

Updating a local source creates a new immutable snapshot and retains previous
versions. Accepted data changes only after reviewed refresh. Runs pin selected
local versions when queued; stale candidates cannot publish. Outputs distinguish
current and earlier accepted revisions, and Activity includes publications and
corrections. Public freshness describes saved acquisition evidence, without
claiming to know whether the external service has subsequently changed.

CSV/TSV import has a delimiter/sample preview. Clean table inspects the complete
chosen saved sheet/range, previews trimming, chosen number/date normalization,
column renaming, blank-row removal, keyed deduplication and sorting, then creates
a separate XLSX. Missing values and leading-zero identifiers survive. Supported
flat rows carry stable source record IDs through cleanup and native full-row
sorting. Direct formulas, undo/redo, filters, save and export use inherited editors.

Source record references identify a saved workbook version, worksheet and original
row. They are not verified evidence for current cell values or document facts.
Accepted research tables have separate stable identities, immutable evidence,
SQLite revisions and persistent corrections. Details resolves a selected research
cell to its snapshot/locator and warns when the sheet differs from accepted data.
Native edits, copied rows, renamed headers/sheets and deleted helper IDs do not
automatically reconcile into that ledger. Record corrections in Workflows.

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
The [workspace use case](docs/testing/workspace-flow-2026-10-10.md) exercises
three supplier quotes through missing-fact review, correction, source update,
refresh, native formula, saved export and fresh-process reopen.

The [process journeys](docs/testing/process-journeys-2026-10-11.md) check mixed
unsupported/conflicting inputs, direct sample-to-full, reviewed source removal,
correction validation, independent workflow reuse and spreadsheet cleanup.
Record keys cannot change through ordinary corrections; protected quote/item
relationships stay together on removal. New projects from workflows open their
input configuration path instead of an unrelated blank workbook.

The [Stages 3–5 contracts and limitations](docs/implementation/research-workflows.md)
define the current document family, public-source scope, field origins, deletion
policy and durable executor. No provider credentials are needed for these tasks.
