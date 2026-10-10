# Infomonk implementation scope and next milestones

Updated 10 October 2026. The owner authorized Stages 1–2, then Stages 3–5.
Stages 0–5 are delivered locally within the supported boundaries below;
Stages 6–8 remain deferred. The supplied build prompt is context, and direct user
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
Run a sample, inspect evidence, cancel the sample, process all confirmed inputs,
review issues and publish. Record corrections in the accepted-table inspector.
Refresh creates candidates; schedules require an open desktop app and never
publish automatically. The full supported journey is in the contracts document.

## Ranked remaining gaps

1. **Broader input families and semantic extraction.** The deterministic quote
   family and single public adapter are intentional bounds. Scans, handwriting,
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

## Deferred roadmap

Stage 6: a specialized research/data engineering harness, reusing the existing
agent/provider streaming, cancellation and tool infrastructure. It should consume
the accepted-ledger contracts and bounded adapters, not recreate chat, editors,
formula evaluation or durable execution.

Stage 7: secondary outputs and table-to-template workflows using inherited
document/slides/PDF/Markdown/HTML editors and writers. Stage 8: hardening, broader
input families, team capabilities and release work as described by the build
prompt. These stages are not claimed as implemented or authorized by this turn.
