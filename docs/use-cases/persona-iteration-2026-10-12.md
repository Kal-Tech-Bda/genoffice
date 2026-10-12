# Persona iteration and wider Bermuda coverage

This iteration addresses two observed problems: reviewing a maintained table becomes slow beyond the first 100 rows, and a small fixed source list misses important employment channels. The workspace now has whole-table search, saved job views and a shortlist action, facts-only refresh summaries, and complete ordinary HTML-table acquisition. The engineering harness remains disabled and last.

## Executed workspace improvements

The synthetic job persona collected 205 listings, found two roles beyond row 100 with one search submission, saved a shortlist view and restored it after restart. Refresh reported one changed posting date and one newly absent listing while retaining all 205 records and personal tracking. A timestamp-only refresh reported no vacancy-fact changes. Search and sort run over the ledger before paging; publishing still uses the full accepted dataset.

The website-table persona collected a 205-row catalogue from a saved HTML source, rejected sample publication and record-key edits, preserved a personal correction across refreshed source values, noticed changed source context, and preserved the accepted revision after a truncated-source failure. An independent exported-workbook check found the final key `000204`, literal formula-like source text, and the expected amount sum 961.25.

The live public-table journey captured all four [official Bermuda holiday tables](https://www.gov.bm/public-holidays), 40 rows and their outside-table notes, with one HTTP request. It published and reopened the native workbook with readable column headings and working cell evidence. Dates remain the website's text. The notes are not interpreted into additional holiday dates.

Native review and meaningful regression tests also caught and fixed stale discovery responses overwriting a changed task, instructions or workflow; missing preceding units/context; context leaking between neighboring tables; and a source header colliding with the hidden evidence record ID. Ambiguous shared context is retained and labelled. The native discovery test exercises task switching, workflow switching, changed source hashes and failed rediscovery without creating an accepted revision.

## Acquisition boundaries

HTML-table input accepts a public HTTPS page or an owned immutable HTML source. Discovery, bounded preview, explicit headers and unique keys precede publication. Initial full collection may consume the same captured page; later web refresh retrieves new bytes, local refresh checks the current source hash, and retry retains its original input. SQLite migration 3 adds named views without changing accepted data.

Whole-table acquisition rejects unrecognized, truncated, nested, hidden, spanned, ragged or paginated tables. There is no general browser/script runner. DNS checks are performed before each supported request/redirect, but DNS is not pinned to the fetch connection. Direct native sheet edits still require reviewed ledger corrections to persist across research refreshes.

## Evidence and remaining work

See the [baseline persona audit](persona-workflow-audit-2026-10-11.md), [acquisition audit](whole-table-acquisition-audit-2026-10-11.md), [native artifacts](../testing/persona-iteration-2026-10-11/results.json) and [expanded source research](bermuda-source-discovery-2026-10-12.md). Those baseline audits describe handoff-time limits; this report records subsequent integrated runtime verification.

The broader Bermuda use case remains an incomplete market search. The next priority is reviewed browser/document observations joining the same tracker: BHB, KPMG and bank portals expose relevant employer roles, while Job Connect, recruiter widgets and advertisement images need honest acquisition boundaries. The government public adapter now uses the same bounded research queue; its executed verification is recorded in the [coverage report](bermuda-coverage-2026-10-12.md). Cross-site vacancy identity, direct-sheet correction reconciliation, additional document families and release/localization work remain separate gaps. No provider-dependent path was exercised and no external application or notification subscription was submitted.
