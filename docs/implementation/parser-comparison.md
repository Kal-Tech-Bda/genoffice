# Supported-corpus parser comparison

Executed 10 October 2026 against the same synthetic supplier-quote corpus.
Decision: retain inherited DOCX/PDF/text parsing. No candidate becomes an
application dependency. The earlier Stage 3 plan proposed Docling first;
Unstructured was selected for this bounded experiment because its DOCX/text path
could be tested without a model runtime. This is one candidate comparison, not
an evaluation of all document parsing products.

The isolated ignored environment used Python 3.14.3 and Unstructured **0.18.15**,
plus `python-docx` and `pdfminer.six`. Application npm/Cargo dependencies and locks
are unchanged. Commands from the repository root:

```powershell
python -m venv .task/infomonk/parser-comparison
.task/infomonk/parser-comparison/Scripts/python.exe -m pip install unstructured==0.18.15 python-docx pdfminer.six
.task/infomonk/parser-comparison/Scripts/python.exe .task/infomonk/compare-parser.py
```

Raw retained output: [parser-comparison-results.json](parser-comparison-results.json).
The driver calls `partition_docx`, `partition_text` and attempts
`partition_pdf(strategy='fast')`, recording output metadata or the exact exception.
The experiment uses synthetic local files and makes no paid API requests.

| Fixture         | Inherited route                                                                                      | Candidate observed result                                                                       | Disposition                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| valid.docx      | Exact original body element anchors; six fields and two items correct in focused/native checks       | Nine paragraphs retained; 0.023 s partition call; metadata lacks original OOXML element indices | No field/locator gap demonstrated                               |
| table.docx      | Six label/value fields and related item cells correct; exact body/row/cell locators in focused tests | Three elements (heading and two tables); table HTML available; 0.004 s                          | Existing structured blocks already expose the needed rows/cells |
| valid.pdf       | Native PDFium text extraction; six correct fields, two items, exact page/line total locator          | Import blocked by `ModuleNotFoundError: No module named pi_heif`                                | Candidate PDF fast path not benchmarked; no quality claim       |
| valid.txt       | Six correct fields and two items; exact line locators                                                | One combined text element                                                                       | Would need additional label/line reconstruction                 |
| missing.md      | Missing total and invalid date remain missing with reasons                                           | Nine text elements retained                                                                     | Partitioning alone does not validate facts                      |
| conflict.txt    | Two totals remain a conflict with both evidence locators                                             | Eleven text elements retained                                                                   | Semantic conflict validation remains required                   |
| unsupported.txt | Supported-family extraction rejected; incomplete coverage                                            | One parsed text element                                                                         | Parsed prose is not successful structured extraction            |
| broken.pdf      | Deliberately invalid input cannot be accepted                                                        | Same optional-dependency import blocker before PDF validation                                   | Failure is not evidence of parser accuracy                      |

Times exclude Python startup/import and are not a comparative performance
benchmark. PDF extras would also import inference/image libraries; those were
not installed because inherited parsing already met the selected text-PDF
family. No OCR/layout quality conclusions are drawn from that blocker. Docling
was source-screened in the Stage 0 research, not runtime-benchmarked here.

The inherited path preserves the structural locators already used by native
viewers and avoids a second runtime. Reconsider a parser for measured failures on
broader layouts/scans, with a larger labeled corpus and independent parsing,
field-accuracy, coverage and locator scores. The replaceable `parseSource` seam
keeps this decision reversible.

Primary references: [Unstructured OSS repository](https://github.com/Unstructured-IO/unstructured),
[partitioning documentation](https://unstructured.readthedocs.io/en/latest/core/partition.html),
[Docling converter](https://docling-project.github.io/docling/reference/document_converter/).
Candidate outputs do not automatically supply accepted values, corrections or
dataset revision transactions.
