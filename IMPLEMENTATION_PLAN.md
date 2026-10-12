# Infomonk implementation scope and next milestones

Updated 12 October 2026. The owner authorized Stages 1–2, then Stages 3–5.
Stages 0–5 are delivered locally within the supported boundaries below;
Further workspace flow features are authorized; the owner's latest order is
UI/UX acceptance, then the data engineering harness next. The supplied build prompt is context, and direct user
scope takes precedence. `assay.md` remains excluded.

| Stage | Delivered behavior                                                                                                                                                                     | Evidence                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0     | Full upstream history, hosted fork, running Windows baseline, capability/reuse audit                                                                                                   | [Historical baseline](docs/audit/verification.md)                                                                       |
| 1     | Real project shell, metadata, navigation, source viewers, themes, Assistant/Details                                                                                                    | [Stage 1–2 checks](docs/implementation/verification.md)                                                                 |
| 2     | Native spreadsheet import, bounded cleanup preview/apply, preserved originals, row origins and save/reopen                                                                             | [Stage 1–2 checks](docs/implementation/verification.md)                                                                 |
| 3     | Supplier-quote PDF/DOCX/text extraction, simple DOCX tables, typed schemas/sample/batch review, related items, transactional accepted cells and corrections, exact immutable evidence  | [Research checks](docs/implementation/research-verification.md), [contracts](docs/implementation/research-workflows.md) |
| 4     | Live bounded World Bank population acquisition, pagination/scope validation, field evidence and country-code enrichment of accepted quotes                                             | [Research checks](docs/implementation/research-verification.md)                                                         |
| 5     | Versioned workflows, durable queue/inputs/checkpoints/events, reviewed refresh diffs, persistent overrides, retry/cancel/recovery, app-open scheduling and input-free structure copies | [Research checks](docs/implementation/research-verification.md)                                                         |

Hosted fork: [Kal-Tech-Bda/genoffice](https://github.com/Kal-Tech-Bda/genoffice).
Local branch: `codex/infomonk-workspace`. Base:
`1ca5e9adfc1807a158db19741eff825dba9ab757`. Upstream history, internal package
names, dependency locks, licenses/notices and `ee/` remain preserved.
No hosted release, installer or provider credential change is part of this work.

## Exercise the current milestone

Use the documented npm development route in README. Try the synthetic cleanup
fixture for Stage 2 and `fixtures/infomonk/research/valid.pdf` for Stages 3–5.
Sources → Build a table from sources opens explicit task/schema/input selection.
Run a sample, inspect evidence, check input readiness, process all confirmed inputs,
review issues and publish. Record corrections in the accepted-table inspector.
Refresh creates candidates; schedules require an open desktop app and never
publish automatically. The full supported journey is in the contracts document.

## Readiness before Stage 6

The [readiness review](docs/testing/pre-stage-6-2026-10-10.md) led to a completed
hardening milestone. History now returns indexed 20-run summaries, table previews
page through 100 rows and full evidence loads on cell selection. Polling is serialized.
On the same synthetic 100-run history, median native IPC fell from 40.37 seconds
to 24 ms. Publication/corrections enforce the sheet reader's 16 Mi-character limit.

[Closed-profile backup and restore](docs/implementation/workspace-recovery.md)
relocate owned references; restored sheet evidence was verified with the original
profile unavailable. A workflow can start a new independent project without its
inputs, records, schedule or corrections. The implementation and regression tests
are checkpointed on the hosted implementation branch.

[Stage 6 preparation](docs/implementation/stage-6-preparation.md) selects invoices,
an independent expected corpus and conservative privacy/cost/resource gates.
Generated execution remains disabled pending an enforced isolated runner.
The [hardening report](docs/testing/hardening-2026-10-10.md) records review and tests.

## Workspace accuracy and flow

The next completed workspace increment routes starts to useful actions, remembers
the actual owned working workbook, reports review/freshness state from the ledger,
filters the entire table for missing facts, retains source versions and pins inputs
at queue time. Current/earlier outputs and publication/correction activity connect
the navigation to maintained research data. Cold spreadsheet opens keep the loading
guard until render modules finish initializing.

The [synthetic supplier comparison](docs/testing/workspace-flow-2026-10-10.md)
uses independently authored expected facts, TXT/DOCX/PDF inputs and real native
editing, save, export and restart. It checks a manual value of 108 against an
incoming source value of 115 without silently replacing the override. No new
parser, framework, hosted service or provider request is needed.

## Process journey review — 11 October 2026

The [process review](docs/testing/process-journeys-2026-10-11.md) extends the
workspace checks to mixed unsupported/conflicting documents, direct sample-to-full,
source scope removal, protected quote/item relationships, invalid corrections,
independent workflow reuse and CSV cleanup. Corrections cannot change record keys
or accept negative facts/malformed codes; key reconciliation remains deferred.
Completed samples remain in history when full execution starts. Copied projects
open the confirmed-input path. Cleanup names its actual saved input and Close
returns to the editor. No engineering runner or additional framework is added.

## Ranked remaining gaps

The guided local quote input readiness check is complete. It reuses inherited
parsing and quote rules, prevents blocked full runs before queueing, preserves
reviewable missing facts, and rejects checks made stale by source/configuration
changes. A publication fence also prevents retries or schedules from accepting
missing/conflicting Quote IDs. The [readiness report](docs/testing/input-readiness-2026-10-11.md)
records the mixed-batch repair journey and verification limits.

The next process priority is a report from a selected accepted table/revision,
carrying missing facts and explicit evidence references into the inherited
Markdown/DOCX writers. Clearer saved-primary versus working-table operations
follow that. The earlier ranked list is retained in the historical process review.
Broader roadmap constraints remain below.

The owner then selected a full Bermuda jobs journey, focused on technology, data
and office roles with manual workspace refresh. A bounded three-site jobs task
now reuses the accepted ledger, queue, evidence inspector and XLSX projection.
The [use-case report](docs/use-cases/bermuda-jobs-2026-10-11.md) records actual
collection, personal tracking, reviewed refresh, failure/disappearance checks and
fresh-process native evidence. No ongoing notification automation was requested.

1. **Broader input families and semantic extraction.** The deterministic quote
   family and fixed public adapters are intentional bounds. Scans, handwriting,
   arbitrary nested forms, provider-driven extraction and arbitrary web research
   need separately measured coverage and evidence guarantees. The isolated parser
   comparison did not justify a production dependency.
2. **Identity reconciliation for unrestricted sheet mutations.** Native editing
   remains available, but header/worksheet changes, helper deletion/copying and
   arbitrary agent writes do not automatically update accepted data. Persistent
   corrections use the ledger UI; CSV loses package evidence. A later harness
   must work through reviewed domain operations instead of raw cell mutation.
3. **Retention and service deployment.** Snapshots/revisions/previews have no
   automatic pruning. SQLite plus app-open execution is the selected local mode.
   Off-computer updates, a hosted executor, team access and service migration
   require another deployment decision; do not add a competing scheduler.
4. **Release readiness.** New workspace copy is English; some secondary chrome
   remains upstream. Credentialed providers, optional cloud services, installers
   and non-Windows runtime remain unverified. Existing Windows path/chmod/symlink
   test failures and baseline dependency advisories require separate compatibility
   work. No broad dependency upgrades were made.

## Remaining order (owner-directed)

The owner's 12 October instruction supersedes the earlier harness-last order.
Finish UI/UX first: exercise project starts, source/table configuration, candidate
review, evidence inspection, tracking, outputs and reopening; address confusing
actions, excessive density and narrow-window failures; verify light/dark themes
and keyboard access through native journeys. Record remaining limitations and
make the result reviewable before advancing.

The specialized research/data engineering harness (original Stage 6) is **next**
after that UI/UX gate. Reuse existing agent/provider streaming, cancellation and
tool infrastructure, accepted-ledger contracts and bounded adapters. Reuse chat,
editors, formula evaluation and durable execution.

The original Stage 7 secondary editors/writers remain available. Richer templates,
localization, broader source coverage, installer publishing and hosted deployment
are separate later work; they are not prerequisites for beginning the harness.

Its frozen preparation inputs remain useful, but generated execution stays
disabled. Installer publishing, paid requests and a hosted/team deployment are
not implied by completing local workspace features.

The expanded Bermuda jobs use case addresses the rejected three-site coverage:
19 public-source adapters, 24 additional coverage targets, pagination, explicit
role groups, partial guest search, publication expiry versus employer deadline,
and JSON snapshot inspection. Next prioritize reviewed browser/document capture
for Job Connect, government, hospital/bank portals and image/PDF advertisements;
then evidence-backed cross-site vacancy reconciliation and facts-only refresh
diffs. See the [ranked gaps](docs/use-cases/bermuda-jobs-wide-2026-10-11.md).

The [12 October iteration](docs/use-cases/persona-iteration-2026-10-12.md) now
implements whole-table job search/sort/filtering, named saved views, one-action
shortlisting and facts-only refresh summaries. It also implements bounded static
HTML-table discovery and maintained-sheet publication, with native full-row,
correction, refresh, context, restart and evidence checks. Reuse of Workday and
BambooHR plus two bounded Greenhouse feeds expands the supported jobs list to
26; the 78-row coverage registry includes 52 targets outside automatic collection.
These increments do not complete the market search. Reviewed employer browser
captures and cross-site observation reconciliation remain the next accuracy gaps.
