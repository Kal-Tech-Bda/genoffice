import {
  publicHtml,
  htmlTag,
  htmlAttr,
  htmlText,
  htmlPath,
  type HtmlNode,
} from '@genoffice/electron-utils/public-html'
import type { JobEntry, JobPage } from './jobs'
import type { JobSiteId } from '../../shared/jobs-api'
import { jobSite, jobStartUrl, jobUrl, jobIsJson, GOVERNMENT_PORTAL_TENANT } from './job-routes'
import { jobScope } from './job-scope'

type ObjectValue = Record<string, unknown>
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Unsupported public job data object.')
  return value as ObjectValue
}
const optionalObject = (value: unknown): ObjectValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : {}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error('Unsupported public job data array.')
  return value
}
function string(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  if (value.length > 2000) throw new Error('Oversized job field.')
  return value.trim()
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000)
    throw new Error('Unsupported public job count.')
  return value
}
const hasClass = (node: HtmlNode, name: string) =>
  htmlAttr(node, 'class').split(/\s+/).includes(name)
const descendants = (nodes: HtmlNode[], node: HtmlNode) => {
  const prefix = htmlPath(node) + '/'
  return nodes.filter((n) => htmlPath(n).startsWith(prefix))
}
const bermuda = (location: string) => /\bBermuda\b|(?:^|[,; ])BM(?:$|[,; ])/i.test(location)

export function parseAdditionalJobs(
  id: JobSiteId,
  bytes: Buffer,
  rawUri: string,
  date: (v: unknown) => string | null,
): JobPage {
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Job response exceeds 2 MiB.')
  const site = jobSite(id),
    uri = jobUrl(id, rawUri),
    url = new URL(uri),
    json = jobIsJson(id, uri)
  const page: JobPage = { units: [], entries: [], links: [], method: `bermuda-jobs-${id}-v2` }
  const proof = (locator: string, text: string) => {
    if (text.length > 200_000) throw new Error('Job proof exceeds supported bounds.')
    const value = { locator, text }
    page.units.push(value)
    return value
  }
  const hp = (n: HtmlNode, text = htmlText(n)) => proof(htmlPath(n), text)
  const jp = (path: string, value: unknown) =>
    proof('JSON ' + path, JSON.stringify(value) ?? 'null')
  const entry = (
    key: string,
    title: string,
    location: string | null,
    listing: string,
  ): JobEntry => ({
    key: `${id}:${key}`,
    title,
    location,
    listing_url: jobUrl(id, listing),
    employer: null,
    posted_date: null,
    closing_date: null,
    proof: {},
    issues: [],
  })
  const add = (row: JobEntry, allowUnknown = false) => {
    if (!jobScope(row.title)) return
    if (!bermuda(row.location ?? '') && !allowUnknown && !bermuda(row.title)) return
    if (/\bsummer\b/i.test(row.title))
      row.issues.push(
        'Seasonal/internship listing: confirm which intake/year is still accepting applications.',
      )
    page.entries.push(row)
  }
  const data = json ? object(JSON.parse(bytes.toString('utf8'))) : null
  const nodes = json ? [] : publicHtml(bytes)
  if (site.adapter === 'linkedin') {
    const list = nodes.find((n) => hasClass(n, 'jobs-search__results-list')),
      headline = nodes.find((n) => htmlTag(n) === 'h1' && /Jobs in Bermuda/i.test(htmlText(n)))
    if (!list || !headline)
      throw Error(
        'LinkedIn public guest results unavailable; sign-in/blocked pages are not zero-job results.',
      )
    const cards = descendants(nodes, list).filter((n) => hasClass(n, 'base-card')),
      advertised = Number(
        htmlText(headline)
          .match(/[\d,]+/)?.[0]
          .replaceAll(',', ''),
      )
    if (
      !cards.length ||
      cards.length > 100 ||
      !Number.isFinite(advertised) ||
      advertised < cards.length
    )
      throw Error('LinkedIn guest result coverage/layout changed.')
    const seen = new Set<string>()
    for (const card of cards) {
      const sub = descendants(nodes, card),
        h = sub.find((n) => hasClass(n, 'base-search-card__title')),
        a = sub.find((n) => hasClass(n, 'base-card__full-link')),
        location = sub.find((n) => hasClass(n, 'job-search-card__location')),
        advertiser = sub.find((n) => hasClass(n, 'base-search-card__subtitle')),
        posted = sub.find((n) => htmlTag(n) === 'time'),
        key = htmlAttr(card, 'data-entity-urn').match(/^urn:li:jobPosting:(\d+)$/)?.[1]
      if (!h || !a || !key || seen.has(key))
        throw Error('LinkedIn public listing identity missing/duplicated.')
      seen.add(key)
      const row = entry(key, htmlText(h), location ? htmlText(location) : null, htmlAttr(a, 'href'))
      if (!new URL(row.listing_url).pathname.endsWith('-' + key))
        throw Error('LinkedIn card/link identity conflict.')
      row.advertiser = advertiser ? htmlText(advertiser) : null
      row.posted_date = posted ? date(htmlAttr(posted, 'datetime')) : null
      row.proof.title = hp(h)
      if (location) row.proof.location = hp(location)
      if (advertiser) row.proof.advertiser = hp(advertiser)
      if (posted) row.proof.posted_date = hp(posted, 'datetime: ' + htmlAttr(posted, 'datetime'))
      row.issues.push(
        'Partial signed-out search: only returned public cards checked. Advertiser may be a recruiter; employer, deadline and full description are unconfirmed. May duplicate an employer/agency listing on another site.',
      )
      add(row)
    }
    page.advertised = advertised
    page.scopeNote = `PARTIAL guest search: ${cards.length} returned public cards checked of ${advertised} reported Bermuda results. Remaining results and full descriptions unverified; no sign-in or application performed.`
    hp(headline)
  } else if (site.adapter === 'wordpress' && data) {
    if (typeof data.found_jobs !== 'boolean')
      throw new Error('Job board response no longer exposes listing coverage.')
    const pages = count(data.max_num_pages),
      current = Number(url.searchParams.get('page'))
    if (pages > 30) throw new Error('Job board exceeds 30 supported result pages.')
    const rows = publicHtml(Buffer.from(typeof data.html === 'string' ? data.html : ''))
    const listings = rows.filter((n) => htmlTag(n) === 'li' && hasClass(n, 'job_listing'))
    if (data.found_jobs && !listings.length) throw new Error('Job board listing layout changed.')
    for (const n of listings) {
      const sub = descendants(rows, n),
        a = sub.find((c) => htmlTag(c) === 'a'),
        h = sub.find((c) => htmlTag(c) === 'h3')
      if (!a || !h) throw new Error('Job board record has no title/link.')
      if (jobScope(htmlText(h))) page.links.push(jobUrl(id, htmlAttr(a, 'href')))
    }
    if (current === 1)
      for (let p = 2; p <= pages; p++) {
        const next = new URL(jobStartUrl(id))
        next.searchParams.set('page', String(p))
        page.links.push(jobUrl(id, next.href))
      }
    page.advertised = listings.length
    page.scopeNote =
      'All returned board advertisements/pages checked; scope uses title rules. Multi-role ads count as one source listing.'
  } else if (site.adapter === 'wordpress') {
    const structured = nodes
      .filter((n) => htmlTag(n) === 'script' && htmlAttr(n, 'type') === 'application/ld+json')
      .flatMap((n) => {
        const value = JSON.parse(
          'childNodes' in n ? n.childNodes.map((c) => ('value' in c ? c.value : '')).join('') : '',
        )
        const candidates = Array.isArray(value)
          ? value
          : [value, ...(Array.isArray(value['@graph']) ? value['@graph'] : [])]
        return candidates
          .filter((v) => v['@type'] === 'JobPosting')
          .map((v) => ({ node: n, value: object(v) }))
      })
    if (structured.length !== 1) throw new Error('Expected one public board JobPosting.')
    const { node, value } = structured[0],
      title = string(value.title)
    if (!title) throw new Error('Board job title missing.')
    const loc = optionalObject(value.jobLocation),
      address = optionalObject(loc.address)
    const location = string(address.addressCountry) ?? string(loc.name)
    const row = entry(
      url.pathname.split('/').filter(Boolean).at(-1)!,
      title,
      location ?? 'Not stated — Bermuda board context only',
      uri,
    )
    const ld = (field: string) => hp(node, `${field}: ${JSON.stringify(value[field])}`)
    row.proof.title = ld('title')
    row.posted_date = date(value.datePosted)
    row.proof.posted_date = ld('datePosted')
    row.advert_expiry = date(value.validThrough)
    row.proof.advert_expiry = ld('validThrough')
    row.employer = string(optionalObject(value.hiringOrganization).name)
    if (row.employer) row.proof.employer = ld('hiringOrganization')
    if (location) row.proof.location = ld('jobLocation')
    else
      row.issues.push(
        'Role location is not stated in the board metadata. Bermuda board context is not confirmation of role location.',
      )
    row.issues.push(
      'Board validThrough is publication expiry, not an established employer application deadline. Image/PDF advert details may need manual reading.',
    )
    if (/\b(?:positions?|and more|second(?:ee|ment))\b/i.test(title))
      row.issues.push(
        'This advertisement can represent several roles; do not count it as one distinct vacancy.',
      )
    add(row, true)
  } else if (site.adapter === 'greenhouse' && data) {
    const rows = array(data.jobs),
      meta = object(data.meta),
      total = count(meta.total)
    if (rows.length !== total || meta.next || meta.next_page || Number(meta.pages ?? 1) > 1)
      throw Error('Greenhouse list coverage is incomplete or unexpectedly paginated.')
    const seen = new Set<number>()
    let officeOnly = 0
    for (let index = 0; index < rows.length; index++) {
      const value = object(rows[index]),
        title = string(value.title),
        location = string(object(value.location).name),
        listing = string(value.absolute_url),
        offices = array(value.offices).map(object)
      if (
        !Number.isSafeInteger(value.id) ||
        Number(value.id) <= 0 ||
        !title ||
        !location ||
        !listing
      )
        throw Error('Greenhouse post identity, title, location or listing URL is missing.')
      const key = Number(value.id)
      if (seen.has(key)) throw Error('Duplicate Greenhouse job post IDs require source review.')
      seen.add(key)
      const canonical = jobUrl(id, listing)
      if (!new URL(canonical).pathname.endsWith('/' + key))
        throw Error('Greenhouse listing URL does not match its post ID.')
      const officeLabels = offices.map((office) => {
        const label = [string(office.name), string(office.location)].filter(Boolean).join(' — ')
        if (!label) throw Error('Greenhouse job-office location metadata is missing.')
        return label
      })
      const headlineBermuda = bermuda(location),
        officeBermuda = officeLabels.some(bermuda)
      if (!headlineBermuda && !officeBermuda) continue
      if (!jobScope(title)) continue
      const row = entry(String(key), title, location, canonical),
        path = `/jobs/${index}`
      row.employer = string(value.company_name)
      // updated_at is a mutation timestamp, not publication or application expiry.
      row.posted_date = date(value.first_published)
      row.closing_date = date(value.application_deadline)
      if (value.application_deadline != null && !row.closing_date)
        throw Error('Greenhouse application deadline shape needs explicit source review.')
      row.proof.title = jp(path + '/title', value.title)
      row.proof.location = jp(path, value)
      if (row.employer) row.proof.employer = jp(path + '/company_name', value.company_name)
      if (row.posted_date)
        row.proof.posted_date = jp(path + '/first_published', value.first_published)
      if (row.closing_date)
        row.proof.closing_date = jp(path + '/application_deadline', value.application_deadline)
      if (!headlineBermuda && officeBermuda) {
        officeOnly++
        row.observation =
          'Listed with conflicting location fields — review; Bermuda option unconfirmed'
        row.issues.push(
          `Role has multiple listed locations or conflicting job-office metadata: headline is ${location}; offices are ${officeLabels.join('; ')}. Confirm the Bermuda option; office metadata does not override the headline or eligibility.`,
        )
      } else if (
        officeLabels.some((label) => !bermuda(label)) ||
        /;|\b(?:or|and)\b/i.test(location)
      ) {
        row.issues.push(
          `Role has multiple listed locations; headline is ${location}; offices are ${officeLabels.join('; ')}. Confirm the Bermuda option.`,
        )
      }
      // A literal Bermuda office is retained as a review lead even when the headline conflicts.
      add(row, officeBermuda)
    }
    page.advertised = total
    page.scopeNote =
      `Entire public Greenhouse board checked (${total} published posts, including explicit job-office fields). ` +
      (page.entries.length
        ? `${page.entries.length} matching source listings; ${officeOnly} have Bermuda office metadata with a conflicting non-Bermuda headline and require location review. `
        : 'No matching posts carried an explicit Bermuda headline or job-office field at this check. ') +
      'Generic remote roles and corporate/description mentions of Bermuda are not treated as Bermuda availability. This is not a market-wide zero-job claim.'
    jp('/meta', data.meta)
  } else if (site.adapter === 'government') {
    if (!data) {
      const title = nodes.find((n) => htmlTag(n) === 'title'),
        widget = nodes.find(
          (n) =>
            htmlTag(n) === 'script' &&
            htmlAttr(n, 'data-lumesse-site-tech-id') === GOVERNMENT_PORTAL_TENANT &&
            htmlAttr(n, 'data-lumesse-fo-host') === 'emea3.recruitmentplatform.com',
        ),
        cutoff = nodes.find(
          (n) =>
            htmlTag(n) === 'label' &&
            htmlText(n) ===
              'Closing time to apply for any job is 7:00pm Bermuda time (AST - Atlantic Standard Time) on the stated closing date',
        )
      if (
        url.pathname !== '/' ||
        !title ||
        htmlText(title) !== 'Government of Bermuda - Careers' ||
        !widget ||
        !cutoff ||
        !nodes.some((n) => htmlAttr(n, 'id') === 'lumesseJobsListWidget')
      )
        throw Error('Government portal identity, public tenant or closing notice changed.')
      hp(title)
      hp(widget, `public tenant: ${GOVERNMENT_PORTAL_TENANT}; host: emea3.recruitmentplatform.com`)
      hp(cutoff)
      page.links.push(jobUrl(id, site.feed!))
      page.scopeNote =
        htmlText(cutoff) +
        '. Capture the public list and scoped vacancy details; no application or login.'
    } else {
      const total = count(object(data.globals).jobsCount)
      const fields = (value: ObjectValue) => {
        const v = object(value.jobFields),
          key = value.id,
          title = string(v.jobTitle)
        if (
          typeof key !== 'number' ||
          !Number.isInteger(key) ||
          key < 1 ||
          key > 99_999_999 ||
          v.id !== key ||
          !title ||
          (v.sJobTitle != null && string(v.sJobTitle) !== title)
        )
          throw Error('Government vacancy identity/title missing or conflicting.')
        return { key, title, v }
      }
      if (url.pathname === '/fo/rest/jobs') {
        const rows = array(data.jobs),
          offset = Number(url.searchParams.get('firstResult'))
        if (
          total > 300 ||
          (offset && offset >= total) ||
          rows.length !== Math.min(10, Math.max(0, total - offset))
        )
          throw Error('Government public vacancy pagination is incomplete or exceeds bounds.')
        const seen = new Set<number>()
        for (const [index, value] of rows.entries()) {
          const { key, title, v } = fields(object(value))
          if (seen.has(key)) throw Error('Duplicate government vacancy ID.')
          seen.add(key)
          jp(`/jobs/${index}/jobFields`, v)
          if (jobScope(title))
            page.links.push(jobUrl(id, new URL(site.feed!).origin + `/fo/rest/jobs/${key}/details`))
        }
        if (offset === 0)
          for (let next = 10; next < total; next += 10) {
            const link = new URL(site.feed!)
            link.searchParams.set('firstResult', String(next))
            page.links.push(jobUrl(id, link.href))
          }
        page.advertised = rows.length
        page.scopeNote = `Government public list reports ${total} vacancies; checked ${rows.length} records at offset ${offset}, queueing all result pages and title-matching details. Pages are independent captures and the portal may change during acquisition. Portal jurisdiction is not an explicit role location.`
        jp('/globals/jobsCount', total)
      } else {
        const { key, title, v } = fields(data)
        if (total !== 1 || String(key) !== url.pathname.split('/')[4])
          throw Error('Government public vacancy detail identity/count conflict.')
        const custom = array(data.customFields)
        for (const value of custom) {
          const field = object(value)
          if (
            !string(field.title) ||
            typeof field.content !== 'string' ||
            field.content.length > 100_000
          )
            throw Error('Government vacancy description fields changed or exceed bounds.')
        }
        const link = new URL('/details.html', site.url)
        link.searchParams.set('jobId', String(key))
        link.searchParams.set('jobTitle', title)
        const row = entry(String(key), title, null, link.href)
        row.proof.title = jp('/jobFields/jobTitle', v.jobTitle)
        row.proof.listing_status = jp('/jobFields', v)
        jp('/customFields', custom)
        row.issues.push(
          'Role location and employer are not explicitly reported in the public vacancy JSON. Government of Bermuda portal jurisdiction is context only; confirm the role location and department before applying.',
        )
        if (v.DPOSTINGEND != null) {
          const timezone = string(v.POSTINGTIMEZONE)
          if (
            typeof v.DPOSTINGEND !== 'number' ||
            !Number.isSafeInteger(v.DPOSTINGEND) ||
            v.DPOSTINGEND < 946684800000 ||
            v.DPOSTINGEND > 4102444800000 ||
            !timezone ||
            !['Atlantic/Bermuda', 'Europe/Paris'].includes(timezone)
          )
            throw Error(
              'Government deadline timestamp/timezone changed; date conversion needs review.',
            )
          const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).formatToParts(v.DPOSTINGEND)
          const part = (kind: string) => parts.find((p) => p.type === kind)?.value
          row.closing_date = date(`${part('year')}-${part('month')}-${part('day')}`)
          row.proof.closing_date = jp('/jobFields', v)
          row.issues.push(
            `Closing date is the calendar date of DPOSTINGEND ${v.DPOSTINGEND} in the source's literal POSTINGTIMEZONE ${timezone}. Portal notice states 7:00pm Bermuda time (AST - Atlantic Standard Time); the API posting timestamp is not a verified application cutoff. Confirm the literal portal notice and date; no UTC offset is inferred.`,
          )
        }
        if (data.hideApplyButton === true || data.generalApplication === true) {
          row.observation = 'Portal application availability/type requires review'
          row.issues.push(
            'Portal reports a hidden application button or general application; current vacancy availability requires review.',
          )
          row.proof.listing_status = jp('/', data)
        }
        add(row, true)
        page.scopeNote =
          'Public government vacancy detail captured. Deadline retains the source calendar date/timezone, with the portal cutoff notice requiring review; salary, qualifications and department remain in immutable evidence.'
      }
    }
  } else if (site.adapter === 'workday' && data) {
    if (url.pathname.endsWith('/jobs')) {
      const total = count(data.total),
        postings = array(data.jobPostings)
      if (!url.searchParams.has('facet')) {
        const flatten = (value: unknown, depth = 0): ObjectValue[] => {
          if (depth > 8) throw Error('Unsupported Workday facet nesting.')
          const v = object(value)
          return [
            v,
            ...(Array.isArray(v.values) ? v.values.flatMap((c) => flatten(c, depth + 1)) : []),
          ]
        }
        const facets = array(data.facets).flatMap((v) => flatten(v))
        const group =
          facets.find(
            (f) =>
              f.facetParameter === 'locationCountry' &&
              Array.isArray(f.values) &&
              f.values.some((v) => bermuda(String(optionalObject(v).descriptor))),
          ) ??
          facets.find(
            (f) =>
              f.facetParameter === 'locations' &&
              Array.isArray(f.values) &&
              f.values.some((v) => bermuda(String(optionalObject(v).descriptor))),
          )
        if (group) {
          const ids = array(group.values)
            .filter((v) => bermuda(String(object(v).descriptor)))
            .map((v) => string(object(v).id)!)
          if (ids.length !== 1)
            throw Error('Multiple Bermuda location facets need explicit adapter review.')
          const next = new URL(jobStartUrl(id))
          next.searchParams.set('facet', String(group.facetParameter))
          next.searchParams.set('value', ids[0])
          page.links.push(jobUrl(id, next.href))
          page.scopeNote =
            'Bermuda country/location facet selected; all selected pages and role details checked.'
        } else {
          if (
            total &&
            !facets.some((f) => ['locationCountry', 'locations'].includes(String(f.facetParameter)))
          )
            throw Error('Workday location facets missing; coverage cannot be established.')
          page.scopeNote =
            'Public portal did not expose a Bermuda country/location facet at this check. No Bermuda records collected; this is not a market-wide zero-job claim.'
        }
        jp('/facets', data.facets)
      } else {
        if (total > 600) throw Error('Bermuda Workday scope exceeds 600 records.')
        const offset = Number(url.searchParams.get('offset') ?? 0)
        if (postings.length !== Math.min(20, Math.max(0, total - offset)))
          throw Error('Workday pagination coverage changed.')
        for (const posting of postings) {
          const v = object(posting),
            path = string(v.externalPath)
          if (!path?.startsWith('/job/')) throw Error('Workday detail path missing.')
          page.links.push(jobUrl(id, new URL(site.feed!).pathname.replace(/\/jobs$/, '') + path))
        }
        if (offset === 0)
          for (let p = 20; p < total; p += 20) {
            const next = new URL(uri)
            next.searchParams.set('offset', String(p))
            page.links.push(jobUrl(id, next.href))
          }
        page.advertised = postings.length
      }
    } else {
      const v = object(data.jobPostingInfo),
        title = string(v.title),
        key = string(v.jobReqId),
        country = string(optionalObject(v.country).descriptor)
      if (!title || !key) throw Error('Workday role identity missing.')
      const locations = [
        string(v.location),
        ...(Array.isArray(v.additionalLocations) ? v.additionalLocations : []).map((l) =>
          typeof l === 'string' ? l : string(optionalObject(l).descriptor),
        ),
      ]
        .filter(Boolean)
        .join('; ')
      const row = entry(
        key,
        title,
        country === 'Bermuda' ? [locations, country].filter(Boolean).join('; ') : locations,
        String(v.externalUrl),
      )
      const reportedEmployer = string(optionalObject(data.hiringOrganization).name)
      row.employer = reportedEmployer ?? site.employer ?? null
      row.posted_date = date(v.startDate)
      row.proof.title = jp('/jobPostingInfo/title', title)
      row.proof.location = jp('/jobPostingInfo', v)
      row.proof.posted_date = jp('/jobPostingInfo/startDate', v.startDate)
      if (reportedEmployer) row.proof.employer = jp('/hiringOrganization', data.hiringOrganization)
      if ((v.additionalLocations as unknown[] | undefined)?.length)
        row.issues.push('Role has multiple listed locations; confirm the Bermuda option.')
      if (v.canApply === false || v.posted === false) {
        row.observation = 'Portal reports unavailable for application — review'
        row.issues.push('Public portal availability flags require review.')
        row.proof.listing_status = jp('/jobPostingInfo', v)
      }
      add(row)
    }
  } else if (site.adapter === 'bamboo' && data) {
    if (url.pathname.endsWith('/list')) {
      const rows = array(data.result),
        total = count(optionalObject(data.meta).totalCount)
      if (rows.length !== total || total > 300)
        throw Error('BambooHR list coverage is incomplete or exceeds supported bounds.')
      page.advertised = total
      for (const r of rows) {
        const v = object(r)
        if (!/^\d+$/.test(String(v.id))) throw Error('BambooHR job ID missing.')
        page.links.push(jobUrl(id, `/careers/${v.id}/detail`))
      }
      page.scopeNote =
        'Entire public BambooHR list and role details checked; non-Bermuda or out-of-scope roles excluded.'
    } else {
      const v = object(object(data.result).jobOpening),
        title = string(v.jobOpeningName)
      if (!title) throw Error('BambooHR role title missing.')
      const loc = object(v.location),
        country = string(loc.addressCountry),
        location = [string(loc.city), string(loc.state), country].filter(Boolean).join(', ')
      const row = entry(url.pathname.split('/')[2], title, location, String(v.jobOpeningShareUrl))
      row.employer = site.employer ?? null
      row.posted_date = date(v.datePosted)
      row.proof.title = jp('/result/jobOpening/jobOpeningName', title)
      row.proof.location = jp('/result/jobOpening/location', loc)
      row.proof.posted_date = jp('/result/jobOpening/datePosted', v.datePosted)
      if (typeof v.description === 'string') {
        if (v.description.length > 100_000) throw Error('Oversized public BambooHR description.')
        const descriptionNodes = publicHtml(Buffer.from(v.description)),
          body = descriptionNodes.find((n) => htmlTag(n) === 'body'),
          description = body ? htmlText(body) : ''
        if (
          /\bwarehouse\b|\blogistics\b|\bfork-?lifts?\b|\bpickup and delivery\b/i.test(description)
        ) {
          row.issues.push(
            'Public description includes warehouse/logistics or physical operational duties. Title-based scope is a review lead; confirm role duties before treating it as an office fit.',
          )
          row.proof.scope_reason = jp('/result/jobOpening/description', v.description)
        }
      }
      if (v.jobOpeningStatus !== 'Open') {
        row.observation = `Portal reports ${String(v.jobOpeningStatus)} — review`
        row.issues.push('Role is not reported Open by the public portal.')
        row.proof.listing_status = jp('/result/jobOpening/jobOpeningStatus', v.jobOpeningStatus)
      }
      add(row)
    }
  } else if (site.adapter === 'oracle' && data) {
    const result = object(array(data.items)[0]),
      rows = array(result.requisitionList),
      total = count(result.TotalJobsCount),
      offset = count(result.Offset)
    if (total > 600 || rows.length !== Math.min(100, Math.max(0, total - offset)))
      throw Error('Oracle public search coverage changed or exceeds supported bounds.')
    page.advertised = rows.length
    for (const [i, r] of rows.entries()) {
      const v = object(r),
        title = string(v.Title),
        key = string(v.Id)
      if (!title || !key || !/^\d+$/.test(key)) throw Error('Oracle role identity missing.')
      const row = entry(key, title, string(v.PrimaryLocation), site.url + '/job/' + key)
      const reportedEmployer = string(v.LegalEmployer)
      row.employer = reportedEmployer ?? site.employer ?? null
      row.posted_date = date(v.PostedDate)
      row.advert_expiry = date(v.PostingEndDate)
      for (const [field, key] of [
        ['title', 'Title'],
        ['location', 'PrimaryLocation'],
        ['employer', 'LegalEmployer'],
        ['posted_date', 'PostedDate'],
        ['advert_expiry', 'PostingEndDate'],
      ] as const) {
        if (field === 'employer' && !reportedEmployer) continue
        row.proof[field] = jp(`/items/0/requisitionList/${i}/${key}`, v[key])
      }
      add(row)
    }
    if (offset === 0)
      for (let p = 100; p < total; p += 100) {
        const next = new URL(jobStartUrl(id))
        next.searchParams.set('finder', next.searchParams.get('finder') + `,offset=${p}`)
        page.links.push(jobUrl(id, next.href))
      }
    page.scopeNote =
      'All Bermuda-keyword public search pages checked, then explicit role locations filtered. Keyword scope is not an exhaustive country-filtered census.'
  } else if (site.adapter === 'breezy') {
    const blocks = nodes.filter((n) => htmlTag(n) === 'li' && hasClass(n, 'position-details'))
    if (!blocks.length || blocks.length > 300) throw Error('Breezy public position layout changed.')
    page.advertised = blocks.length
    const seen = new Map<string, string>()
    for (const block of blocks) {
      const sub = descendants(nodes, block),
        h = sub.find((n) => htmlTag(n) === 'h2'),
        a = sub.find((n) => htmlTag(n) === 'a')
      if (!h || !a) throw Error('Breezy role title/link missing.')
      const title = htmlText(h),
        listing = jobUrl(id, htmlAttr(a, 'href')),
        key = new URL(listing).pathname.split('/')[2].split('-')[0]
      if (seen.has(key)) {
        if (seen.get(key) !== title) throw Error('Conflicting mirrored Breezy role records.')
        continue
      }
      seen.set(key, title)
      const location =
        sub.find((n) => hasClass(n, 'location')) ??
        sub.find(
          (n) =>
            htmlTag(n) === 'li' &&
            /Hamilton, BM|George Town|Road Town|London, GB/.test(htmlText(n)),
        )
      const row = entry(
        key,
        title,
        location
          ? htmlText(location)
          : bermuda(title)
            ? 'Title names Bermuda; role location requires confirmation'
            : null,
        listing,
      )
      row.proof.title = hp(h)
      if (location) row.proof.location = hp(location)
      row.issues.push(
        'Agency client and closing date are unstated on the checked list. Mirrored multi-location cards count once.',
      )
      if (bermuda(title) && !bermuda(row.location ?? ''))
        row.issues.push(
          'Title includes Bermuda but another location is listed; confirm the Bermuda option.',
        )
      add(row)
    }
    page.scopeNote =
      'All public list cards checked; exact mirrored IDs reconciled, client identity and deadlines remain missing.'
  } else if (site.adapter === 'ccs') {
    const intro = nodes.find(
      (n) => htmlTag(n) === 'p' && /currently open in our Hamilton office/i.test(htmlText(n)),
    )
    if (
      !intro ||
      !nodes.some((n) => /CCS Is Always Looking/.test(htmlText(n)) && htmlTag(n) === 'h1')
    )
      throw Error('CCS vacancy scope/layout changed.')
    const titles = nodes.filter((n) => htmlTag(n) === 'h5')
    if (!titles.length) throw Error('CCS role headings missing; closure is unconfirmed.')
    page.advertised = titles.length
    for (const h of titles) {
      const title = htmlText(h),
        row = entry(title.toLowerCase().replace(/\s+/g, ' '), title, 'Hamilton, Bermuda', site.url)
      row.employer = site.employer!
      row.proof.title = hp(h)
      row.proof.location = hp(intro)
      row.issues.push(
        'Title-based employer-page key may conflate reposts. No posted date/deadline is stated.',
      )
      add(row)
    }
  } else if (site.adapter === 'clarien') {
    const headings = nodes.filter((n) => htmlTag(n) === 'h3')
    for (const h of headings) {
      let block = 'parentNode' in h ? h.parentNode : null
      while (block && !/Closing date:/.test(htmlText(block)))
        block = 'parentNode' in block ? block.parentNode : null
      if (!block || htmlTag(block) === 'body') continue
      const title = htmlText(h),
        sub = descendants(nodes, block),
        closing = sub.find(
          (n) => htmlTag(n) && /^Closing date:\s*\d{4}-\d{2}-\d{2}$/.test(htmlText(n)),
        ),
        row = entry(
          title.toLowerCase().replace(/\s+/g, ' '),
          title,
          'Bermuda career page; confirm role location',
          site.url,
        )
      row.employer = site.employer!
      row.proof.title = hp(h)
      if (closing) {
        row.closing_date = date(htmlText(closing).match(/\d{4}-\d{2}-\d{2}/)?.[0])
        row.proof.closing_date = hp(closing)
      }
      row.issues.push(
        'Role location is not stated on the vacancy card; confirm the Bermuda role. Title key may conflate reposts. Linked PDF requirements need separate reading.',
      )
      add(row)
      page.advertised = (page.advertised ?? 0) + 1
    }
    if (!page.advertised)
      throw Error('Clarien vacancy-card layout changed; not treated as zero vacancies.')
  } else if (site.adapter === 'taleo') {
    if (url.pathname.endsWith('/searchResults')) {
      if (!nodes.some((n) => ['h1', 'h2'].includes(htmlTag(n)) && htmlText(n) === 'Search Results'))
        throw Error('Artex search layout changed.')
      page.links = nodes
        .filter((n) => htmlTag(n) === 'a' && htmlAttr(n, 'href').includes('/viewRequisition?'))
        .map((n) => jobUrl(id, htmlAttr(n, 'href')))
      if (nodes.some((n) => htmlTag(n) === 'a' && /Next|More Results/i.test(htmlText(n))))
        throw Error('Artex pagination requires adapter review.')
      page.advertised = new Set(page.links).size
    } else {
      const panel = nodes.find((n) => hasClass(n, 'oracletaleocwsv2-job-description')),
        sub = panel && descendants(nodes, panel),
        h = sub?.find((n) => /^h[1-4]$/.test(htmlTag(n)) || htmlTag(n) === 'strong')
      if (!h) throw Error('Artex public role heading missing.')
      const title = htmlText(h),
        row = entry(
          url.searchParams.get('rid')!,
          title,
          'Bermuda talent-solutions page; confirm role location',
          uri,
        )
      row.proof.title = hp(h)
      row.issues.push('Recruiter client identity and employer deadline require review.')
      const statement = nodes.find(
        (n) =>
          htmlTag(n) === 'p' &&
          /not a current need|often require|future opportunities/i.test(htmlText(n)),
      )
      if (statement) {
        row.observation = 'Talent pool / evergreen — not confirmed current vacancy'
        row.proof.listing_status = hp(statement)
        row.issues.push('Recruiter describes an ongoing talent pool rather than a current vacancy.')
      }
      add(row)
    }
  } else if (site.adapter === 'deloitte') {
    if (
      !nodes.some(
        (n) => /^h[1-3]$/.test(htmlTag(n)) && /Search for open positions/.test(htmlText(n)),
      )
    )
      throw Error('Deloitte result layout changed.')
    const headings = nodes.filter(
      (n) => htmlTag(n) === 'h3' && hasClass(n, 'article__header__text__title'),
    )
    page.advertised = headings.length
    for (const h of headings) {
      const a = descendants(nodes, h).find((n) => htmlTag(n) === 'a')
      if (!a) throw Error('Deloitte role link missing.')
      const title = htmlText(h),
        listing = jobUrl(id, htmlAttr(a, 'href')),
        row = entry(
          new URL(listing).pathname.split('/').at(-1)!,
          title,
          bermuda(title) ? 'Bermuda' : null,
          listing,
        )
      row.employer = site.employer!
      row.proof.title = hp(h)
      if (bermuda(title)) row.proof.location = hp(h)
      add(row)
    }
    page.links = nodes
      .filter(
        (n) =>
          htmlTag(n) === 'a' &&
          /\/cbcapply\/SearchJobs\/?\?/.test(htmlAttr(n, 'href')) &&
          /pipelineOffset=/.test(htmlAttr(n, 'href')),
      )
      .map((n) => jobUrl(id, htmlAttr(n, 'href')))
    page.scopeNote =
      'Every linked result page checked; listings can describe future intake opportunities.'
  } else if (site.adapter === 'island') {
    if (!nodes.some((n) => /^h[1-3]$/.test(htmlTag(n)) && htmlText(n) === 'Bermuda'))
      throw Error('Island recruiter Bermuda section missing.')
    // Wix repeats some responsive text. Identical title/location facts are one card;
    // the agency does not expose stable client vacancy IDs on this page.
    const titles = nodes.filter(
      (n) =>
        ['p', 'h2', 'h3', 'h4'].includes(htmlTag(n)) &&
        /\(Bermuda\)/.test(htmlText(n)) &&
        htmlText(n).length < 150,
    )
    const seen = new Set<string>()
    for (const h of titles) {
      const title = htmlText(h)
      if (seen.has(title)) continue
      seen.add(title)
      const row = entry(title.toLowerCase().replace(/\s+/g, ' '), title, 'Bermuda', site.url)
      row.proof.title = hp(h)
      row.proof.location = hp(h)
      row.issues.push(
        'Agency client/deadline are unstated on this list. Title-based key may conflate reposts.',
      )
      add(row)
    }
    if (!seen.size) throw Error('Island recruiter vacancy layout changed.')
    page.advertised = seen.size
  } else throw Error('Unsupported public source adapter.')
  page.links = [...new Set(page.links)]
  if (page.links.length > 600 || page.entries.length > 300)
    throw Error('Job page exceeds supported record/link bounds.')
  if (new Set(page.entries.map((r) => r.key)).size !== page.entries.length)
    throw Error('Duplicate listing keys require source review.')
  proof(
    json ? 'JSON acquisition' : 'HTML acquisition',
    `Parsed ${page.entries.length} matching source records and ${page.links.length} queued public pages from ${uri}. ${page.scopeNote ?? ''}`,
  )
  return page
}
