# Independently expected readiness fixtures

`missing-key.txt` is a labeled quote with no business key. It must block a full
run, even though its total is 22 CAD. `key-fixed.txt` corrects only that missing
Quote ID to Q-300. No key is invented by extraction or readiness.

`no-text-layer.pdf` is a reproducible one-page PDF containing only a colored page
rectangle, with no text layer. It represents the unsupported text-coverage case;
this check does not perform OCR. Regenerate with `node fixtures/infomonk/readiness/generate.mjs`.

Native tests combine these files with the existing independently authored valid,
conflicting and missing-fact quotes. They also add an identical copy of `valid.txt`.
Initially there are six confirmed snapshots, five unique contents, three inputs
needing review and two blocked inputs. After updating the keyless quote and
explicitly excluding the textless PDF, five snapshots represent four unique
contents: one ready and three needing review, with zero blockers.

The full candidate has Q-100 with a conflicting/missing total, Q-200 with a missing
total and invalid/missing date, and Q-300 with total 22. Readiness must not invent
either missing total or silently exclude any input. These process fixtures are
not the engineering harness or an arbitrary-document accuracy benchmark.
