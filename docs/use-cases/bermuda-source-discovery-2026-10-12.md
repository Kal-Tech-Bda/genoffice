# Bermuda source discovery — 12 October 2026

This discovery pass adds **21 organizations with inspected primary recruitment boundaries**, plus one Mount Saint Agnes primary-index follow-up. These extend the existing 43 targets; they are not 21 fully collected vacancy sources. No new vacancy rows have been imported by this discovery task. The scope remains technology, data and office roles in Bermuda, with manual workspace refresh.

The [machine-readable observations](../testing/bermuda-coverage-2026-10-12/discovery-additions.json) record exact primary URLs, evidence levels, observed roles and limitations. Web-tool views can use cached content, so observations are dated and should be rechecked by supported acquisition. One organization is counted once even when its careers page and ATS occupy different domains. Parent-agent insurer/broker discoveries are recorded separately.

## Priority additions

| Primary recruitment source                                                    | Observed boundary or lead                                                                     | Limitation                                                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [Ocorian](https://www.ocorian.com/careers/search)                             | Hamilton trust administration and Bermuda corporate administration details                    | Selected details only; complete Hamilton pagination remains to collect                                   |
| [Carey Olsen](https://www.careyolsen.com/careers/vacancies)                   | Three explicit Bermuda corporate/trust role entries                                           | Global technology roles require country/location resolution; deadlines unstated                          |
| [Steph Brown](https://www.recruitment.bm/projects)                            | Controller, Risk Leader and specialist Risk Actuary blocks explicitly in Bermuda              | Unnamed clients, no dates/deadlines; Controller qualifications conflict with duties                      |
| [Teneo](https://www.teneo.com/careers/open-positions/)                        | Bermuda-labelled Senior Consultant, Financial Advisory                                        | Body references to Bermuda alone are insufficient; old indexed role ID redirects                         |
| [ACT](https://www.act.bm/careers/)                                            | Local IT/support/sales/accounting capacity invitation                                         | Evergreen intake; four capacities do not prove four current vacancies                                    |
| [IEP](https://www.iep.bm/jobs)                                                | Executive and corporate administration talent needs                                           | Old list dates; inspected details describe continuing talent connections                                 |
| [ASU BIOS](https://www.bios.asu.edu/careers)                                  | Marine Science Technician with IT/network/data acquisition duties, employer says until filled | Shipboard/scientific role with substantial time at sea; other relevant-adjacent deadlines already passed |
| [Performance Solutions](https://psolutions.bm/)                               | Official Open Roles link to BambooHR                                                          | Empty web extraction; current jobs and locations unresolved                                              |
| [CML](https://www.cml.ky/bermuda)                                             | Explicit Bermuda technology/finance/legal recruitment and public job portal                   | Shazamme widget unresolved; scaffold zero must not become a zero-job claim                               |
| [Ontru](https://www.ontru.bm/)                                                | Local recruiter career section and application boundary                                       | Image content needs reading before assuming current advertisements                                       |
| [BTA](https://www.gotobermuda.com/bta/employment-opportunities)               | Official tourism/data organization employment boundary                                        | Embedded list unresolved                                                                                 |
| [Elevate Selection Bermuda](https://www.elevateselection.com/for-job-seekers) | Verified local recruiter and process                                                          | No current public role list established                                                                  |

## Institutional checks

Primary pages report no current positions at [Bermuda College](https://www.college.bm/index.php/job-postings), [BCAA](https://www.bcaa.bm/careers), [Regulatory Authority](https://www.ra.bm/about/careers), [Bermuda Health Council](https://healthcouncil.bm/about-us/), [Cancer and Health Centre](https://www.cancer.bm/about-us/employment-opportunities), [Somersfield](https://mysomersfield.com/careers), [Warwick Academy](https://www.warwick.bm/job-opportunities) and [BHS](https://www.bhs.bm/about/careers). These are useful future coverage boundaries, not additional vacancies.

[Harneys](https://www.harneys.com/careers/) links a public Salesforce list showing one page with four Cayman roles and no Bermuda entries; its Bermuda office is verified separately. This is a statement about that observed public list. [Mount Saint Agnes](https://msa.bm/career-opportunities/) is a lower-confidence primary-index follow-up because current page opens failed; its indexed after-school assistants are outside the selected role scope.

## Quality gates raised by the use case

The [Wakefield Quin board item](https://www.bermudajobfinder.com/job/wakefield-quin-limited-barristers-and-attorneys-20260721100641) is an estate/caveat public notice misclassified as a job. Exclude it before vacancy publication. Employer-linked details, actual work location, deadline freshness and vacancy versus talent-pool status matter more than raw source counts.

Cancer and Health's opened page says it is not hiring while its search index still advertises an oncology role. Likewise, old Teneo job IDs can redirect to the global list. Retrieval success must establish a recognized vacancy boundary rather than merely a successful page load.

BMG, Powertranz, BAS and BEDC are verified local employer sites, but current recruitment routes were not established. Ad Opus, BermudAir, BWW and the Police portal have narrower or unresolved evidence. They remain separate follow-ups in the JSON and do not inflate the 21 inspected recruitment boundaries. BWW's Appleby client posting also needs reconciliation against existing employer/LinkedIn entries.

Next, collect every relevant public result page and selected detail from the high-priority sources; resolve the two recruiter widgets; read Ontru images; retain explicit-zero sources for manual refresh. Do not import samples, evergreen capacity invitations or inaccessible portal contents as confirmed vacancies.
