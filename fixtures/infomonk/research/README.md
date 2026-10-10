# Synthetic research corpus

These are generated demonstration quotes, not real supplier records.
Run `node fixtures/infomonk/research/generate.mjs` from the root. Expected values
and locators are in `expected.json` and the focused research tests.

| File                   | Purpose                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| valid.pdf              | Text-layer supplier quote Q-100, total 125.50, two related items                 |
| valid.docx / valid.txt | Equivalent quote in inherited DOCX blocks / text lines; business-key dedupe      |
| table.docx             | Equivalent quote in label/value and flat line-item tables; cell locators         |
| missing.md             | Q-200 lacks total and contains an invalid ISO date; missing facts remain missing |
| conflict.txt           | Q-100 states two totals; no invented accepted total                              |
| unsupported.txt        | Unsupported family; incomplete coverage blocks publication                       |
| broken.pdf             | Deliberately invalid PDF; cannot claim successful parsing                        |

Live World Bank observations are recorded separately in implementation verification.
Injected HTTP fixtures in native/unit checks are explicitly labeled and are not
presented as live source evidence.
