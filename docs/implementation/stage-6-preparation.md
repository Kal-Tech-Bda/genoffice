# Stage 6 preparation contract

This hardening milestone defines defaults and evaluation inputs. It does not
enable a coding agent, generated-code runner or private cloud processing.
`assay.md` remains excluded. The owner initially moved the engineering harness
to the final phase, then updated the order on 12 October: UI/UX acceptance followed
directly by the harness. This contract remains preparation until that next
milestone; execution is disabled during the UI/UX pass.

## First input pattern and independent evaluation

Start with **supplier-invoices-v1**: labeled, born-digital supplier invoices with
an invoice number, supplier identity, issued date, currency, payable amount,
tax/subtotal where supplied, and related line items with quantity/unit/unit price.
This extends coverage beyond the existing Supplier Quote family. OCR, arbitrary
websites and unrestricted nested documents remain later work.

The hand-authored corpus is
[`fixtures/infomonk/engineering/expected.json`](../../fixtures/infomonk/engineering/expected.json).
One basic example is available for development. Three held-out examples cover an
amended invoice with instruction-like document text, a different supplier/period
using the same invoice number, and contradictory totals with missing currency.
Expected facts and exact source line locators were authored independently of an
extractor; no extraction result or model accuracy is claimed. Held-out expected
answers must stay outside agent context and generated pipelines.

Use supplier identity plus invoice number and issued-period identity to separate
records; amendments update the matching record while retaining reviewer overrides.
Missing/contradictory facts stay null with review issues. Units remain explicit.
Document text cannot grant host access, bypass review or change publication rules.

Before claiming the first pattern supported, test text plus independent DOCX/PDF
renderings, missing pages/fields, conflicting copies, reordered rows and correction
preservation. The four current text cases are preparation, not production coverage.
Measure field accuracy, input/record coverage, evidence correctness, latency,
cost and reviewer effort. Every required held-out fact and evidence locator must
pass; partial acquisition and failed checks must leave accepted data unchanged.

## Data, execution and cost gates

`research/engineering-policy.ts` exports a frozen, server-owned contract. Its
read-only project-authorized IPC route exposes the defaults. Renderer fields,
source text and workflow notes cannot enable execution or relax them.

| Boundary                     | Current default / prerequisite                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Private document processing  | Local-only future engineering mode; private cloud requests disabled                                                    |
| Generated pipeline execution | Disabled; deny helper throws until replaced by a verified isolated runner boundary                                     |
| Cost                         | USD 0; no paid/provider engineering request permitted by this contract                                                 |
| Agent turns                  | Maximum 8 when a harness is separately enabled                                                                         |
| Sample wall time             | Maximum 60 seconds                                                                                                     |
| Runner resources             | CPU 10 seconds, memory 512 MiB, output 5 MiB                                                                           |
| Filesystem                   | Immutable selected input mounts and one bounded output directory; no user profile, credentials or arbitrary host paths |
| Network                      | Denied for generated pipelines; public retrieval stays in application-owned bounded adapters                           |
| Publication                  | Application-owned schema, coverage, evidence, revision and human-review gates outside agent control                    |

The limits are requirements for the future runner, not operating-system enforcement
implemented in this turn. A subprocess, timeout or model permission prompt alone
does not establish isolation. Stage 6 must select and verify an isolation mechanism
that enforces all listed boundaries; if unavailable, execution stays disabled.
The existing Assistant/provider configuration remains available under its inherited
behavior. This policy is scoped to the future engineering harness and does not
claim a whole-application private-data guarantee. No provider credentials were
used or live model request made in this milestone.

## Bounded implementation recommendation

Build one invoice-pattern adapter and its held-out evaluator first. Use the existing
agent/provider transport for planning and messages, the accepted ledger for reviewed
domain mutations, the same durable queue for attempts, and inherited editors/writers
for outputs. Keep source acquisition and publication in application-owned code.
Expose the runner only after filesystem/network/resource denial tests pass and
provider/data/cost choices are explicitly configured. Do not duplicate the
assistant loop, spreadsheet engine, persistence or scheduler.
