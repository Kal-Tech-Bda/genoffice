# Bounded Bermuda jobs workflow

The owner requested technology, data and office listings across several websites,
with manual tracking inside Infomonk. The task is in Workflows → Research task →
**Bermuda jobs → manual tracker**. Select the career websites, save, inspect a
sample if useful, run all confirmed inputs, review missing facts/location issues,
and publish. Refresh job listings reacquires the selected pages and creates a
candidate; accepted data changes only after publication.

## Source scope

The owner rejected the three-site pilot as insufficient. The registry now has
19 supported public checks: the three below plus LinkedIn guest search (partial),
JobsInBDA, Hamilton, CCS, Clarien, OneComm, Skyport, Artex, Island, Deloitte,
AXIS, Arch, Hiscox, Athora, Everest and Chubb. `jobs-api.ts` is the exact registry;
`job-routes.ts` fences routes/fetches, `job-adapters.ts` handles measured HTML/JSON
shapes, and `job-scope.ts` labels title groups. Source checks contains 24 additional
uncollected targets with null counts/dates. See the
[expanded audit](../use-cases/bermuda-jobs-wide-2026-10-11.md) for exact boundaries.

- [BMA](https://jobs.jobvite.com/bmacareers/jobs): one server-rendered current-openings
  list and at most ten selected detail pages. JobPosting data supplies title,
  employer, posted date and country; an explicit deadline sentence supplies closing
  date. A Bermuda office address used when role location is absent is labeled uncertain.
- [Coralisle](https://fs-320.my.salesforce-sites.com/recruit/fRecruit__ApplyJobList):
  a verified one-page list, at most ten selected details, structured posting and
  visible company/jurisdiction/deadline fields. Bahamas listings are excluded.
  All Jurisdictions is included with a Bermuda-location review warning.
- [Expertise](https://www.expertisegroup.com/available-jobs): recognized vacancy
  blocks on the agency page, at most 80 matching rows. Staff bios are excluded.
  Employer/deadline/posted date are missing when not disclosed on that checked
  page. A title mentioning Bermuda with a contradictory Cayman location remains
  visible for review. Linked PDFs are not automatically fetched.

Matching uses declared title keywords for technology/data/office roles. This is
not arbitrary web discovery, semantic qualification matching or an exhaustive
job market census. New sites need a separately measured adapter. There is no
login, application submission, résumé processing or paid model request.

## Tracking and evidence

Jobs and Source checks use the same accepted ledger, durable queue and XLSX
projection as the inherited research tasks. Selected sources are explicitly
confirmed; copied workflows/projects clear that selection. BMA/Coralisle keys
use provider vacancy IDs. Agency keys use title/location and may represent reposts.
Exact duplicate keys in a page reject acquisition. Similar named employer/title
rows are flagged across sources rather than silently merged; undisclosed clients
prevent reliable cross-site reconciliation. Counts describe source listings.

Source fields and observation times are read-only in the correction UI. Application
status choices are To review, Saved, Applied, Interviewing, Offer, Declined and
Not pursuing. Status and personal notes persist through refresh via the existing
override ledger. A manual status records a user's choice, not proof of an actual
application. Native XLSX edits do not silently update that ledger.

First seen persists for a listing key. Last seen changes only when the listing
is observed again. Last checked uses its actual acquisition time; reused retry
inputs do not pretend to have been fetched again. A missing listing remains with
the old last-seen facts and **Not found in latest check — review; not confirmed
closed**. Excluding a source retains its rows with an outside-scope observation
and leaves their prior acquisition timestamp intact. Raw retrieval failure or an
unrecognized layout fails the run and cannot publish over accepted data.

Deadline checks use Bermuda's calendar day. Due today is distinct from past
deadline; a still-listed expired deadline is a review condition. A listing being
present does not prove applications remain open. Generic change totals include
check timestamps and source versions; inspect role/deadline/observation fields
to distinguish actual vacancy changes from a new check.

Snapshots retain SHA256, original URL, retrieval time, extraction method and
normalized DOM/structured-field evidence. The inspector verifies trusted stored
input bytes and the stored parsed unit. Native sheet Details resolves the same
accepted record. HTML evidence is viewed as text; website scripts are not executed.
Open live listing permits only a stored row on the selected registered route,
including candidate/accepted workflow ownership checks. It cannot open an apply
route or arbitrary renderer URL.

## Bounds and verification

No new processing dependency was installed. parse5 was already a dependency of
electron-utils; only a shared helper export was added. Per response: 2 MiB,
20-second timeout, HTML or declared public JSON, redirect rejection, HTTPS allowlisted routes,
50,000 DOM nodes and 200 levels. Sites run sequentially through the existing
queue. HTTP failures have explicit retry/new-check controls, not silent fallback
to snippets. All configured bounded acquisitions must complete before publication;
partial guest/keyword coverage remains explicit. Public pagination/detail links
use a canonical-URL queue, at most 900 acquired pages per source. Duplicate source
keys across pages fail rather than inflate counts. Workday uses only a public
read-only search POST, then verified Bermuda facets and count-checked pagination.
No authentication or application endpoint is called. JSON proof units resolve
from the same immutable hash-checked stored parser output as HTML units.

The separate `bermuda-jobs-2/schema-2` processing version leaves existing quote
and World Bank versions intact. Existing publication limits and profile recovery
continue to apply; no second database or scheduler is introduced. The demonstrated
workflow has no schedule, notifications or background automation. The engineering
harness remains last and disabled.

Old job candidates require a new run; previously accepted revisions are retained.
New fields distinguish publication expiry from employer deadline and advertiser
from employer. Analyst domains and actuarial roles are labeled separately from
technology/data. Talent pools, seasonal intake and already-expired employer
deadlines require review, even while a listing remains present.

Executed facts, synthetic failure/disappearance tests, screenshots and remaining
gaps are in [the expanded use case](../use-cases/bermuda-jobs-wide-2026-10-11.md).
