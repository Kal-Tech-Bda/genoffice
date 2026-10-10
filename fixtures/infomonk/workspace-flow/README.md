# Supplier comparison workspace use case

All names, documents and reviewer statements are synthetic. Expected business
facts in `expected.json` were authored independently of extraction code.
The fixture generator packages those plain facts as a DOCX and a text-layer PDF;
it does not run the extractor or generate expected answers from application data.

Regenerate the two packaged fixtures with:

```powershell
node fixtures/infomonk/workspace-flow/generate.mjs
```

1. Extract from files → create a project from `northwind.txt`.
2. Sources → add `cedar.docx` and `maple.pdf`.
3. Build a table from sources → Supplier quotes → save a workflow.
4. Run sample; verify one quote and disabled publication. Cancel the sample,
   then Run all confirmed inputs. Three quotes and three related items result.
5. Needs review shows Maple's missing total. The labeled total is blank; the
   extractor must not infer a payable total of 110 from quantity × unit price.
6. Review and publish. Home → Needs review → Review table opens that missing fact.
   Record 108 with the synthetic correction reason in `expected.json`.
7. Sources → update Northwind to `northwind-v2.txt` and Maple to `maple-v2.txt`.
   Inspect the previous versions. Accepted totals remain 100, 90 and 108.
8. Home flags changed inputs. Refresh the quote workflow, review and publish.
   Northwind becomes 120, Cedar stays 90, Maple stays manual 108; source evidence
   now shows Maple's incoming total 115 separately.
9. Open the current accepted workbook. Set H1 to `Lowest accepted quote (CAD)`
   and H2 to `=MIN(E2:E4)`. The independent expected result is 90. Save, export
   XLSX, close the app and reopen the project; inspect E4 in Details.

Native and unit checks live in `e2e/infomonk-workspace-flow.spec.ts` and
`apps/shell/tests/workspace-flow.test.ts`. This is a supported-family workspace
journey, not an evaluation of arbitrary invoices, OCR, web research or AI models.
