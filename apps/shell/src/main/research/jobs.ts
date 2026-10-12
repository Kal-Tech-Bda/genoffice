import {
  publicHtml,
  htmlTag,
  htmlAttr,
  htmlText,
  htmlPath,
  type HtmlNode,
} from '@genoffice/electron-utils/public-html'
import { jobSite, jobUrl } from './job-routes'
export { jobSite, jobUrl, jobStartUrl, fetchJobPage } from './job-routes'
import { jobScope } from './job-scope'
import { parseAdditionalJobs } from './job-adapters'
import { JOB_SITES, JOB_DISCOVERY_SITES, type JobSiteId } from '../../shared/jobs-api'
import type {
  Evidence,
  ResearchDataset,
  ResearchRow,
  ResearchTable,
} from '../../shared/research-api'
import { cell, hash } from './extract'

type Proof = { locator: string; text: string }
export interface JobEntry {
  key: string
  title: string
  employer: string | null
  location: string | null
  closing_date: string | null
  posted_date: string | null
  listing_url: string
  proof: Record<string, Proof>
  issues: string[]
  observation?: string
  advert_expiry?: string | null
  advertiser?: string | null
}
export interface JobPage {
  units: Proof[]
  entries: JobEntry[]
  links: string[]
  method: string
  scopeNote?: string
  advertised?: number
}
export interface JobObservation {
  site: JobSiteId
  page: JobPage
  source: Omit<Evidence, 'locator' | 'excerpt' | 'method'>
}
const focus = { test: (title: string) => !!jobScope(title) }
export const JOB_COLUMNS: ResearchTable['columns'] = [
  ['job_key', 'Listing key', 'text'],
  ['title', 'Role', 'text'],
  ['employer', 'Employer', 'text'],
  ['location', 'Listed location', 'text'],
  ['closing_date', 'Closing date', 'date'],
  ['posted_date', 'Posted date', 'date'],
  ['listing_url', 'Listing URL', 'text'],
  ['source_site', 'Source site', 'text'],
  ['listing_status', 'Listing observation', 'text'],
  ['deadline_status', 'Deadline check', 'text'],
  ['first_seen', 'First seen', 'text'],
  ['last_seen', 'Last seen', 'text'],
  ['last_checked', 'Last checked', 'text'],
  ['application_status', 'Application status', 'text'],
  ['notes', 'My notes', 'text'],
  ['role_group', 'Role group (title rule)', 'text'],
  ['scope_reason', 'Scope and limitations', 'text'],
  ['advert_expiry', 'Publication expiry (not employer deadline)', 'date'],
  ['advertiser', 'Advertiser (may be recruiter)', 'text'],
].map(([id, name, type]) => ({ id, name, type: type as 'text' | 'date' }))
function date(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  let iso = value.match(/^\d{4}-\d{2}-\d{2}(?:T|$)/)?.[0].slice(0, 10)
  if (!iso) {
    const m = value.match(/^(\d{1,2}) ([A-Za-z]+) (\d{4})$/)
    const month =
      [
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december',
      ].indexOf(m?.[2].toLowerCase() ?? '') + 1
    if (m && month) iso = `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  return iso && Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0, 10) === iso
    ? iso
    : null
}
function scoped(entry: JobEntry): boolean {
  return (
    focus.test(entry.title) &&
    (/bermuda|all jurisdictions/i.test(entry.location ?? '') || /bermuda/i.test(entry.title))
  )
}
function elementChildren(node: HtmlNode): HtmlNode[] {
  return 'childNodes' in node ? node.childNodes.filter((n) => htmlTag(n)) : []
}
export function parseJobPage(siteId: JobSiteId, bytes: Buffer, uri: string): JobPage {
  if (jobSite(siteId).adapter) return parseAdditionalJobs(siteId, bytes, uri, date)
  const url = jobUrl(siteId, uri),
    nodes = publicHtml(bytes)
  const page: JobPage = { units: [], entries: [], links: [], method: `bermuda-jobs-${siteId}-v1` }
  const proof = (node: HtmlNode, text = htmlText(node)): Proof => {
    if (text.length > 200_000) throw new Error('Job evidence text exceeds supported bounds.')
    const unit = { locator: htmlPath(node), text }
    page.units.push(unit)
    return unit
  }
  if (siteId === 'expertise') {
    if (
      !nodes.some(
        (n) =>
          ['h1', 'h2', 'h3', 'h4'].includes(htmlTag(n)) &&
          /Available Jobs|Permanent Positions|Temporary Positions/.test(htmlText(n)),
      )
    )
      throw new Error('Expertise page no longer exposes the supported vacancy layout.')
    const groups = nodes.filter(
      (n) =>
        htmlTag(n) === 'div' && htmlAttr(n, 'class').split(/\s+/).includes('s-rich-text-wrapper'),
    )
    let recognized = 0
    for (const group of groups) {
      let ancestor = 'parentNode' in group ? group.parentNode : null
      let vacancyBlock = false
      while (ancestor) {
        if (htmlAttr(ancestor, 'class').split(/\s+/).includes('s-item-text')) {
          vacancyBlock = true
          break
        }
        ancestor = 'parentNode' in ancestor ? ancestor.parentNode : null
      }
      if (!vacancyBlock) continue
      const paragraphs = elementChildren(group).filter((n) => htmlTag(n) === 'p')
      for (let i = 0; i < paragraphs.length; i++) {
        const start = paragraphs[i]
        if (!/font-size:\s*14px/.test(htmlAttr(start, 'style')) || !htmlText(start)) continue
        const nearby = paragraphs.slice(i + 1, i + 5)
        const locationNode = nearby.find((n) => /^(Bermuda|Cayman)$/i.test(htmlText(n)))
        if (!locationNode)
          throw new Error(
            `An Expertise vacancy has an unrecognized location layout (${htmlText(start).slice(0, 80)}); coverage cannot be confirmed.`,
          )
        const location = htmlText(locationNode),
          titleNodes = paragraphs
            .slice(i, paragraphs.indexOf(locationNode))
            .filter((n) => /font-size:\s*14px/.test(htmlAttr(n, 'style')) && htmlText(n)),
          title = titleNodes.map(htmlText).join(' ')
        const titleProof = {
          locator:
            titleNodes.length === 1
              ? htmlPath(start)
              : `${htmlPath(start)} → ${htmlPath(titleNodes.at(-1)!)}`,
          text: title,
        }
        page.units.push(titleProof)
        recognized++
        const entry: JobEntry = {
          key: `expertise:${title.toLowerCase().replace(/\s+/g, ' ')}:${location.toLowerCase()}`,
          title,
          employer: null,
          location,
          closing_date: null,
          posted_date: null,
          listing_url: url,
          proof: { title: titleProof, location: proof(locationNode) },
          issues: [
            'Agency client and closing date are not disclosed on this listing page. No vacancy ID is supplied; title/location keys may represent reposts.',
          ],
        }
        if (/bermuda/i.test(title) && !/bermuda/i.test(location))
          entry.issues.push(
            'Role title and listed location disagree. Confirm Bermuda eligibility with the recruiter.',
          )
        if (scoped(entry)) page.entries.push(entry)
        i = paragraphs.indexOf(locationNode)
      }
    }
    if (!recognized)
      throw new Error(
        'Expertise has no recognized vacancy blocks; this is not treated as confirmed closure.',
      )
  } else if (siteId === 'bma' && new URL(url).pathname.endsWith('/jobs')) {
    if (
      !nodes.some(
        (n) =>
          ['h1', 'h2'].includes(htmlTag(n)) && /Open Positions|Current Openings/.test(htmlText(n)),
      )
    )
      throw new Error('BMA page no longer exposes the supported current-openings layout.')
    if (
      nodes.some(
        (n) =>
          htmlTag(n) === 'a' &&
          (htmlAttr(n, 'rel') === 'next' ||
            /\/bmacareers\/jobs\?.*(?:page|offset)=/i.test(htmlAttr(n, 'href'))),
      )
    )
      throw new Error('BMA pagination is outside the supported one-page listing scope.')
    page.links = nodes
      .filter(
        (n) =>
          htmlTag(n) === 'a' &&
          /^\/bmacareers\/job\/[a-zA-Z0-9]+$/.test(htmlAttr(n, 'href')) &&
          focus.test(htmlText(n)),
      )
      .map((n) => jobUrl(siteId, htmlAttr(n, 'href')))
    if (
      !page.links.length &&
      !nodes.some(
        (n) =>
          /No open positions|No current openings/i.test(htmlText(n)) &&
          ['p', 'h2'].includes(htmlTag(n)),
      )
    )
      throw new Error(
        'No supported BMA role links found; this is not treated as confirmed closure.',
      )
  } else if (siteId === 'coralisle' && new URL(url).pathname.endsWith('ApplyJobList')) {
    if (
      !nodes.some(
        (n) => ['h1', 'h2', 'h3'].includes(htmlTag(n)) && /Current Vacancies/.test(htmlText(n)),
      )
    )
      throw new Error('Coralisle vacancy layout changed.')
    const body = nodes.find((n) => htmlTag(n) === 'body')!
    if (!/Page 1 of 1/.test(htmlText(body)))
      throw new Error('Coralisle pagination is outside the supported one-page scope.')
    for (const row of nodes.filter((n) => htmlTag(n) === 'tr')) {
      const cols = elementChildren(row).filter((n) => htmlTag(n) === 'td')
      if (
        cols.length !== 4 ||
        !focus.test(htmlText(cols[0])) ||
        !/^(Bermuda|All Jurisdictions)$/.test(htmlText(cols[2]))
      )
        continue
      const prefix = htmlPath(cols[0]) + '/'
      const link = nodes.find((n) => htmlTag(n) === 'a' && htmlPath(n).startsWith(prefix))
      if (!link) throw new Error('A Coralisle role has no supported detail link.')
      page.links.push(jobUrl(siteId, htmlAttr(link, 'href')))
    }
  } else {
    const ldNodes = nodes.filter(
      (n) => htmlTag(n) === 'script' && htmlAttr(n, 'type') === 'application/ld+json',
    )
    const jobs = ldNodes.flatMap((n) => {
      const raw =
        'childNodes' in n ? n.childNodes.map((c) => ('value' in c ? c.value : '')).join('') : ''
      const value = JSON.parse(raw) as Record<string, unknown>
      return value['@type'] === 'JobPosting' ? [{ node: n, value }] : []
    })
    if (jobs.length !== 1) throw new Error('Expected one structured JobPosting on this role page.')
    const { node, value } = jobs[0]
    const ld = (field: string): Proof => proof(node, `${field}: ${JSON.stringify(value[field])}`)
    const title = typeof value.title === 'string' ? value.title.trim() : ''
    if (!title || title.length > 500) throw new Error('Job title is missing or oversized.')
    const entry: JobEntry = {
      key: `${siteId}:${siteId === 'bma' ? new URL(url).pathname.split('/').at(-1) : new URL(url).searchParams.get('vacancyNo')}`,
      title,
      employer: null,
      location: null,
      closing_date: null,
      posted_date: date(value.datePosted),
      listing_url: url,
      proof: { title: ld('title'), posted_date: ld('datePosted') },
      issues: [],
    }
    if (siteId === 'bma') {
      entry.employer =
        typeof value.hiringOrganization === 'string' ? value.hiringOrganization : null
      if (entry.employer) entry.proof.employer = ld('hiringOrganization')
      const loc = Array.isArray(value.jobLocation) ? value.jobLocation : [value.jobLocation]
      const countries = loc
        .map((l) => (l as { address?: { addressCountry?: unknown } })?.address?.addressCountry)
        .filter((v) => typeof v === 'string' && v)
      if (countries.length) {
        entry.location = countries.join('; ')
        entry.proof.location = ld('jobLocation')
      } else {
        const footer = nodes.find(
          (n) => htmlTag(n) === 'p' && /BMA House.*Hamilton/i.test(htmlText(n)),
        )
        if (footer) {
          entry.location = 'Bermuda office; role location unstated'
          entry.proof.location = proof(footer)
          entry.issues.push(
            'Bermuda office address is stated; role location is not explicitly supplied.',
          )
        }
      }
      const closing = nodes
        .filter((n) => htmlTag(n) === 'p')
        .find((n) => /no later than \d{1,2} [A-Za-z]+ \d{4}/i.test(htmlText(n)))
      if (closing) {
        entry.closing_date = date(
          htmlText(closing).match(/no later than (\d{1,2} [A-Za-z]+ \d{4})/i)![1],
        )
        entry.proof.closing_date = proof(
          closing,
          htmlText(closing).match(/no later than \d{1,2} [A-Za-z]+ \d{4}/i)![0],
        )
      }
    } else {
      const rows = nodes.filter((n) => htmlTag(n) === 'tr')
      for (const [label, field] of [
        ['Company Name', 'employer'],
        ['Jurisdiction', 'location'],
        ['Application Closing Date', 'closing_date'],
      ] as const) {
        const row = rows.find((n) =>
          elementChildren(n).some((c) => htmlTag(c) === 'th' && htmlText(c) === label),
        )
        const data = row && elementChildren(row).find((n) => htmlTag(n) === 'td')
        if (data) {
          entry[field] = field === 'closing_date' ? date(htmlText(data)) : htmlText(data) || null
          entry.proof[field] = proof(data)
        }
      }
      const ldClosing = date(value.validThrough)
      if (ldClosing && entry.closing_date && ldClosing !== entry.closing_date) {
        entry.closing_date = null
        entry.issues.push('Structured and visible closing dates disagree.')
      }
    }
    if (scoped(entry)) page.entries.push(entry)
    else if (!entry.location)
      throw new Error('Role location could not be established; input scope requires review.')
  }
  page.links = [...new Set(page.links)]
  if (page.links.length > 10 || page.entries.length > 80)
    throw new Error('Job source exceeds supported coverage (10 detail pages or 80 agency rows).')
  if (new Set(page.entries.map((e) => e.key)).size !== page.entries.length)
    throw new Error('Duplicate listing keys require source review; jobs were not silently merged.')
  page.units.push({
    locator: 'HTML acquisition',
    text: `Parsed ${page.entries.length} matching role records and ${page.links.length} detail links from ${url}.`,
  })
  return page
}
const evidenceFor = (observation: JobObservation, proof: Proof): Evidence => ({
  ...observation.source,
  locator: proof.locator,
  excerpt: proof.text,
  method: observation.page.method,
})
export function jobDataset(
  observations: JobObservation[],
  prior: ResearchDataset | null,
  selected: JobSiteId[],
): ResearchDataset {
  const old = new Map(prior?.tables.find((t) => t.id === 'jobs')?.rows.map((r) => [r.id, r]) ?? [])
  const rows: ResearchRow[] = []
  for (const observation of observations)
    for (const entry of observation.page.entries) {
      const id = hash(`job:${entry.key}`).slice(0, 24),
        previous = old.get(id)
      const day = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Atlantic/Bermuda',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(observation.source.retrievedAt))
      const deadline = entry.closing_date
        ? entry.closing_date < day
          ? 'Past deadline'
          : entry.closing_date === day
            ? 'Due today'
            : 'Future deadline'
        : 'Not stated'
      const derived = [evidenceFor(observation, observation.page.units.at(-1)!)]
      const values: Record<string, string | null> = {
        title: entry.title,
        employer: entry.employer,
        advertiser: entry.advertiser ?? null,
        location: entry.location,
        closing_date: entry.closing_date,
        posted_date: entry.posted_date,
        listing_url: entry.listing_url,
        job_key: entry.key,
        source_site: jobSite(observation.site).name,
        listing_status:
          entry.observation ??
          (deadline === 'Past deadline'
            ? 'Listed with past deadline — review'
            : entry.advert_expiry && entry.advert_expiry < day
              ? 'Listed after publication expiry — review; employer deadline unconfirmed'
              : 'Listed at last check; availability unconfirmed'),
        deadline_status: deadline,
        first_seen: (previous?.cells.first_seen.value as string) ?? observation.source.retrievedAt,
        last_seen: observation.source.retrievedAt,
        last_checked: observation.source.retrievedAt,
        application_status: 'To review',
        notes: '',
        role_group: jobScope(entry.title) ?? 'Scope review',
        scope_reason:
          entry.issues.join(' ') ||
          'Title-rule matching only; confirm requirements and availability.',
        advert_expiry: entry.advert_expiry ?? null,
      }
      rows.push({
        id,
        cells: Object.fromEntries(
          JOB_COLUMNS.map((c) => {
            const proof = entry.proof[c.id],
              ev = proof
                ? [evidenceFor(observation, proof)]
                : ['application_status', 'notes'].includes(c.id)
                  ? []
                  : derived
            const issues =
              c.id === 'location' &&
              (/all jurisdictions|not stated|confirm/i.test(entry.location ?? '') ||
                !/\bBermuda\b|(?:^|[,; ])BM(?:$|[,; ])/i.test(entry.location ?? '') ||
                entry.issues.some((i) => /^Role has multiple listed locations/i.test(i)))
                ? ['Confirm the Bermuda location before applying.']
                : c.id === 'job_key'
                  ? entry.issues
                  : []
            return [
              c.id,
              cell(
                values[c.id],
                ev,
                `Not stated on the checked listing`,
                issues,
                ['application_status', 'notes', 'role_group', 'scope_reason'].includes(c.id)
                  ? 'internal'
                  : 'external',
              ),
            ]
          }),
        ),
      })
      if (previous) rows.at(-1)!.cells.first_seen = structuredClone(previous.cells.first_seen)
      old.delete(id)
    }
  for (const row of old.values()) {
    const retained = structuredClone(row),
      site = JOB_SITES.find((s) => String(row.cells.job_key.value).startsWith(s.id + ':'))
    retained.cells.advertiser ??= cell(null, [], 'Not stated on the prior listing', [], 'external')
    retained.cells.role_group ??= cell(
      jobScope(String(row.cells.title.value)) ?? 'Scope review',
      [],
      null,
      [],
      'internal',
    )
    retained.cells.scope_reason ??= cell(
      'Retained prior listing; review source and scope.',
      [],
      null,
      [],
      'internal',
    )
    retained.cells.advert_expiry ??= cell(
      null,
      [],
      'Not established on prior acquisition',
      [],
      'external',
    )
    const check = observations.find((o) => o.site === site?.id)
    const message =
      site && selected.includes(site.id)
        ? 'Not found in latest check — review; not confirmed closed'
        : 'Outside selected sources — retained'
    const ev = check ? [evidenceFor(check, check.page.units.at(-1)!)] : []
    retained.cells.listing_status = cell(
      message,
      ev,
      null,
      ['Absence is not proof that a role closed.'],
      'external',
    )
    if (check)
      retained.cells.last_checked = cell(check.source.retrievedAt, ev, null, [], 'external')
    rows.push(retained)
  }
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error('Duplicate listing keys across source pages require review.')
  const near = new Map<string, ResearchRow[]>()
  for (const row of rows) {
    if (!row.cells.employer.value) continue
    const key = `${row.cells.employer.value}:${row.cells.title.value}`
      .toLowerCase()
      .replace(/\s+/g, ' ')
    near.set(key, [...(near.get(key) ?? []), row])
  }
  for (const group of near.values())
    if (group.length > 1)
      for (const row of group)
        row.cells.title.issues.push(
          'Similar employer/title across listings; inspect sources before treating these as distinct vacancies.',
        )
  const sources: ResearchRow[] = selected.map((site) => {
    const list = observations.find((o) => o.site === site)!
    const count = observations
      .filter((o) => o.site === site)
      .reduce((n, o) => n + o.page.entries.length, 0)
    return {
      id: hash(`job-source:${site}`).slice(0, 24),
      cells: {
        source: cell(jobSite(site).name, [], null, [], 'external'),
        last_checked: cell(
          observations
            .filter((o) => o.site === site)
            .map((o) => o.source.retrievedAt)
            .sort()
            .at(-1)!,
          [],
          null,
          [],
          'external',
        ),
        matched_rows: cell(count, [], null, [], 'external'),
        source_url: cell(jobSite(site).url, [], null, [], 'external'),
        status: cell(
          list.page.scopeNote ?? 'Checked selected listing pages',
          list ? [evidenceFor(list, list.page.units.at(-1)!)] : [],
          null,
          [],
          'external',
        ),
      },
    }
  })
  for (const previous of prior?.tables.find((t) => t.id === 'job_sources')?.rows ?? []) {
    if (sources.some((r) => r.id === previous.id)) continue
    if (previous.cells.last_checked.value === null) continue
    const retained = structuredClone(previous)
    retained.cells.status = cell('Outside selected sources — retained', [], null, [], 'external')
    sources.push(retained)
  }
  for (const site of [...JOB_SITES, ...JOB_DISCOVERY_SITES]) {
    const id = hash(`job-source:${site.id}`).slice(0, 24)
    if (sources.some((r) => r.id === id)) continue
    sources.push({
      id,
      cells: {
        source: cell(site.name, [], null, [], 'internal'),
        last_checked: cell(null, [], 'Not collected in this run', [], 'internal'),
        matched_rows: cell(null, [], 'Not searched; this is not a zero-job result', [], 'internal'),
        source_url: cell(site.url, [], null, [], 'internal'),
        status: cell(
          JOB_SITES.some((s) => s.id === site.id)
            ? 'Not selected — not checked'
            : 'Manual search / additional adapter needed — not collected',
          [],
          null,
          [],
          'internal',
        ),
      },
    })
  }
  return {
    schemaVersion: 1,
    issues: [
      'Selected sources and title-based technology/data/office matching only; not an exhaustive Bermuda job search. Listed does not guarantee applications remain open.',
      'Source checks includes discovery targets that were not collected. Null counts are unsearched coverage, not zero vacancies. Adjacent quantitative, mixed-role and talent-pool listings require review.',
    ],
    tables: [
      {
        id: 'jobs',
        name: 'Jobs',
        rowMeaning:
          'One source listing per stable source key; application status and notes are maintained separately',
        columns: JOB_COLUMNS,
        rows,
      },
      {
        id: 'job_sources',
        name: 'Source checks',
        rowMeaning:
          'Public source coverage: completed bounded checks, partial searches and uncollected targets',
        columns: [
          { id: 'source', name: 'Source', type: 'text' },
          { id: 'last_checked', name: 'Last checked', type: 'text' },
          { id: 'matched_rows', name: 'Matching listings', type: 'number' },
          { id: 'source_url', name: 'Source URL', type: 'text' },
          { id: 'status', name: 'Check result', type: 'text' },
        ],
        rows: sources,
      },
    ],
  }
}
