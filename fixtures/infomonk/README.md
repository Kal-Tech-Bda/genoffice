# Synthetic local-workflow fixtures

These contain no private data. Create a project using either file, confirm the
delimiter, then open **Clean table** and inspect the saved workbook.

For suppliers, select ID as the duplicate key, trim whitespace, remove the blank
row and sort by ID. Five input rows become three. The numeric amount total moves
from 35 to 25. ID `001` remains text; Gamma's missing amount remains missing.
The mixed dates deliberately need an explicit interpretation: a chosen date
policy converts only matching valid strings, leaving others unchanged with a
warning. No date or amount is invented.

Expenses includes leading-zero identifiers, a duplicate and a missing amount.
After removing the second `0002`, the amount total is 27.5.

`suppliers-formulas.xlsx` adds `=SUM(C2:C6)` at C7 to the supplier fixture;
the result is 35 before deduplication. Regenerate it with
`npx tsx fixtures/infomonk/generate-formula-fixture.mts` using installed dependencies.
Trimming preserves the formula. Row-removal and sorting cleanup is blocked for
formula-bearing or structurally complex workbooks. Direct editing, filtering,
ordinary calculations and export remain in the inherited editors.
