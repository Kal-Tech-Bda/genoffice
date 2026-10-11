# Process journey fixtures

`unsupported.txt` is an independently written negative fixture: no supported quote heading or facts exist. Publication must be blocked when it is included in an otherwise valid run.

The process tests also use the existing hand-authored research fixtures. `valid.txt` has Quote ID Q-100, total 125.50 CAD and two items. `conflict.txt` repeats Q-100 with two incompatible total labels (125.50 and 130.00). Combining them must yield one quote with a missing total, conflicting evidence and an explicit review step. A reviewer may then record 130 as a persistent correction with a reason.

The source-removal journey uses the three-supplier fixtures in `../workspace-flow`. After correcting Cedar's item quantity to 4 and excluding Northwind and Cedar from scope, default publication retains all three quotes and their items. Explicit reviewed removal deletes unprotected Northwind, while Cedar and its related items stay together. Maple's missing total remains missing. These expectations are authored independently of extraction output; they do not constitute an accuracy benchmark or the deferred engineering harness.

`supplier-register.csv` contains four records and an independently expected total of 49 before cleanup. Trimming, deduplicating by ID and sorting keeps `001 / Alpha / 10`, `002 / Beta / 15` and the missing-key `Unassigned / 4` record. One duplicate is removed, the total becomes 29, and the original bytes must stay unchanged. No missing ID is invented.
