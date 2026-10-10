# Infomonk implementation status and next-stage plan

Updated 9 October 2026. Implemented boundary: **Stages 0–2**. The owner explicitly
selected completing Stages 1–2 first. Stages 3–8 are deferred.

## Delivered

| Stage                                  | Result                                                                                                                                                                                      | Evidence                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 0: fork, baseline and deep audit       | Full upstream history, hosted fork, executed Windows baseline, capability traces and primary-source candidate screen                                                                        | [Baseline verification](docs/audit/verification.md), [research](docs/research.md), [reuse map](docs/reuse-map.md) |
| 1: real workspace                      | Original Infomonk mark/theme, Home/Projects, shared creation, persistent project metadata, native editor bounds, project sections, Assistant/Details                                        | [UI specification](docs/ui-spec.md), [architecture](ARCHITECTURE.md), actual screenshots                          |
| 2: existing spreadsheet to clean table | CSV/TSV/XLSX import, full saved-scope profile, explicit transformations, preview/discard, separate cleaned workbook, record references, previous version, native editing/save/export/reopen | [Implementation verification](docs/implementation/verification.md), synthetic fixtures and focused tests          |

Hosted fork: [Kal-Tech-Bda/genoffice](https://github.com/Kal-Tech-Bda/genoffice).
Local implementation branch: `codex/infomonk-workspace`. The upstream baseline is
`1ca5e9adfc1807a158db19741eff825dba9ab757`; dependencies and upstream history are
preserved. See [the manifest](docs/upstream-manifest.md) for environment and sync.

## How to exercise the milestone

1. Run `npm ci`, `npm run fixtures`, `npm run fixtures -w @genoffice/sheets`,
   `npm run build:all`, then `npm run dev` from the repository root.
2. Create a project with `fixtures/infomonk/suppliers.tsv`; confirm Tab delimiter.
3. Open Clean table, inspect the saved sheet/range, select ID as a duplicate key,
   trim whitespace, remove entirely blank rows, sort by ID and choose a date
   policy if desired. Preview before applying.
4. Five rows become three; amount total changes from 35 to 25. The original
   file and workbook remain intact. Missing amount stays missing and invalid
   dates stay visible with a warning.
5. Apply, edit directly in Univer, use native formulas/undo/filter commands, save,
   restart, reopen the project and Export workbook. Save native edits before
   using cleanup or exporting the project's saved workbook.

The interface works without a model provider. Live assistant requests retain the
inherited provider stack but were not sent during verification.

## Ranked remaining gaps

1. **Accepted data and field evidence.** Row-origin references are intentionally
   limited. Add stable table/column IDs, candidate versus accepted values,
   source locators, persistent human corrections and revision transactions in
   Stage 3 before claiming verified extraction or maintained datasets.
2. **Document extraction with measured coverage.** Sources already preserve and
   display files. Parsing, schema proposal, field extraction and review remain
   absent. Reuse available parsers first; choose an external parser from measured
   gaps rather than installing the entire research list.
3. **Managed-record mutation boundaries.** Cleanup and native full-row sorting
   preserve IDs; assistant sort proposals are blocked for managed tables. Manual
   helper deletion/copying, arbitrary edits and repeated column/worksheet changes
   need identity reconciliation. CSV export loses workbook provenance metadata.
4. **Release readiness.** New workspace copy is English. Inherited editor locales
   remain. Secondary editor chrome still carries upstream branding. Installer
   packaging, inherited non-Windows default-app integration, cross-platform execution, credentialed providers and optional cloud
   services need their own verification. No production release was built.
5. **Inherited platform failures.** Windows unit fixtures still have POSIX path,
   chmod and symlink assumptions; the baseline Docs protection failure remains.
   Pin upgrades and the 14 baseline npm advisories need a separate compatibility
   decision. Native Rust tests passed in the final attempt without policy changes.

## Bounded Stage 3: simple documents to structured sheets

**Input family:** text-based supplier quotes in PDF and DOCX, optionally equivalent
Markdown/text. One row means one quote. Fields: supplier, quote date, currency,
quote identifier and total. Repeated line items go in a related sheet. Defer scans,
handwriting, arbitrary nested forms, web collection and schedules.

**Reuse first:** source snapshots and native previews in WorkspaceStore; DOCX
blocks/OOXML indices from `docx-engine`; existing `file-parse` and PDF text/layout
paths; existing provider transport, structured tool validation, Univer and XLSX
writer. Do not rebuild source viewers, chat or provider configuration.

1. Create a small labeled corpus with valid quotes, missing fields, conflicting
   totals, duplicate inputs and one failed file. Record expected values and
   exact source locators. Parsing coverage and field accuracy are separate scores.
2. Compare inherited extraction against **one** parser candidate, initially
   Docling, on the same corpus. Adopt it only if missing structure/locators or
   measured accuracy justify its runtime and licensing cost. Keep a replaceable
   `parseSource(version) -> structuredDocument` seam. No parser is installed now.
3. Add a separate local transactional accepted-data store, initially evaluate
   SQLite through the already available Node runtime. Keep ProjectStore for UI
   metadata and chats. Version schema and migrations; document later service
   migration. Search-index SQLite must remain a regenerable cache.
4. Establish contracts for project/schema version, stable table/row/column IDs,
   source version, candidate/accepted value, missing reason, evidence locator,
   extraction method, attempt, validation issue, human correction and revision.
   Import Stage 2 record IDs as origin links; do not equate them with validated
   field evidence. XLSX remains a projection/export of accepted data.
5. Implement typed schema/sample review, bounded batch processing and explicit
   incomplete coverage. Use a configured provider or a clearly supported
   deterministic document-family extractor. Keep absent facts absent and validate
   values plus locators before acceptance.
6. Connect Details to the exact immutable snapshot and page/bounding box or DOCX
   block/table cell. A missing locator is a visible review issue. Human corrections
   must be stored independently from a new extraction attempt.
7. Test duplicate-input idempotence, correction survival, failed-file coverage,
   transaction rollback, crash/restart and accepted revision reopening. No failed
   attempt may overwrite an accepted table.

**Exit criteria:** an extracted cell opens its correct original evidence; missing
facts/evidence remain visible; duplicate files do not duplicate records; a human
correction persists; failed files show incomplete coverage; accepted data survives
restart. Implement only the storage and processing needed for those guarantees.

## Later roadmap

Stage 4: bounded web acquisition and mixed-source enrichment. Stage 5: reusable
workflows, refresh, change review and a durable executor. Stage 6: specialized data
engineering harness using inherited agent/provider infrastructure. Stage 7: secondary outputs and table-to-template workflows. Stage 8: hardening,
advanced inputs and team capabilities as described in the build prompt.
None of those subsystems is claimed as implemented by this milestone.
