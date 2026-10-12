import { readBodyCapped } from '@genoffice/electron-utils/remote-image'
import { JOB_SITES, type JobSite, type JobSiteId } from '../../shared/jobs-api'

export function jobSite(id: JobSiteId): JobSite {
  const site = JOB_SITES.find((s) => s.id === id)
  if (!site) throw new Error('Unsupported job source.')
  return site
}
export const jobStartUrl = (id: JobSiteId) => jobSite(id).feed ?? jobSite(id).url
export function jobUrl(id: JobSiteId, raw: string): string {
  const site = jobSite(id),
    url = new URL(raw, site.url)
  const allowedOrigin =
    url.origin === new URL(site.url).origin ||
    (id === 'linkedin' && url.origin === 'https://bm.linkedin.com')
  if (!allowedOrigin || url.username || url.password || url.hash)
    throw new Error('Job links must stay on the selected public career site.')
  const params = [...url.searchParams.keys()]
  if (params.some((k) => url.searchParams.getAll(k).length !== 1))
    throw new Error('Duplicate job route parameters.')
  const only = (keys: string[]) => params.every((k) => keys.includes(k))
  let allowed = false
  if (site.adapter === 'linkedin') {
    if (url.pathname === '/jobs/search/')
      allowed =
        url.origin === 'https://www.linkedin.com' &&
        only(['keywords', 'location']) &&
        url.searchParams.get('keywords') === '' &&
        url.searchParams.get('location') === 'Bermuda'
    else if (
      /^\/jobs\/view\/[a-zA-Z0-9%_-]+-\d+\/?$/.test(url.pathname) &&
      only(['position', 'pageNum', 'refId', 'trackingId', 'trk'])
    ) {
      url.search = ''
      allowed = true
    }
  } else if (id === 'bma')
    allowed = /^\/bmacareers\/(?:jobs|job\/[a-zA-Z0-9]+)$/.test(url.pathname) && !url.search
  else if (id === 'coralisle')
    allowed =
      /^\/recruit\/fRecruit__ApplyJob(?:List)?$/.test(url.pathname) &&
      only(['portal', 'vacancyNo']) &&
      (!url.searchParams.has('portal') || url.searchParams.get('portal') === 'CGI') &&
      (url.pathname.endsWith('List') || /^VN\d+$/.test(url.searchParams.get('vacancyNo') ?? ''))
  else if (site.adapter === 'wordpress')
    allowed =
      (url.pathname === '/' && !url.search) ||
      (/^\/job\/[a-z0-9-]+\/$/.test(url.pathname) && !url.search) ||
      (url.pathname === '/jm-ajax/get_listings/' &&
        only(['page', 'per_page']) &&
        url.searchParams.get('per_page') === '100' &&
        /^[1-9]\d?$/.test(url.searchParams.get('page') ?? ''))
  else if (site.adapter === 'breezy')
    allowed =
      !url.search && (url.pathname === '/' || /^\/p\/[a-f0-9]{12}-[a-z0-9-]+$/.test(url.pathname))
  else if (site.adapter === 'bamboo')
    allowed = !url.search && /^\/careers(?:\/list|\/\d+(?:\/detail)?)?$/.test(url.pathname)
  else if (site.adapter === 'workday') {
    const feed = new URL(site.feed!),
      prefix = feed.pathname.replace(/\/jobs$/, ''),
      human = new URL(site.url).pathname
    const detail = (base: string) =>
      url.pathname.startsWith(base + '/job/') &&
      /^[a-zA-Z0-9%_-]+\/[a-zA-Z0-9%_-]+$/.test(url.pathname.slice((base + '/job/').length)) &&
      !url.search
    allowed =
      (url.pathname === human && !url.search) ||
      detail(human) ||
      detail(prefix) ||
      (url.pathname === feed.pathname &&
        only(['offset', 'facet', 'value']) &&
        (!url.searchParams.has('offset') ||
          /^(?:0|[1-9]\d{0,2})$/.test(url.searchParams.get('offset')!)) &&
        (!url.searchParams.has('facet') ||
          ['locations', 'locationCountry'].includes(url.searchParams.get('facet')!)) &&
        (!url.searchParams.has('value') || /^[a-f0-9]{32}$/.test(url.searchParams.get('value')!)) &&
        url.searchParams.has('facet') === url.searchParams.has('value'))
  } else if (site.adapter === 'taleo')
    allowed =
      /^\/phe03\/ats\/careers\/v2\/(?:searchResults|viewRequisition)$/.test(url.pathname) &&
      only(['org', 'cws', 'rid']) &&
      url.searchParams.get('org') === 'FRONTIER' &&
      url.searchParams.get('cws') === '40' &&
      (url.pathname.endsWith('searchResults') || /^\d+$/.test(url.searchParams.get('rid') ?? ''))
  else if (site.adapter === 'deloitte')
    allowed =
      ((url.pathname === '/cbcapply/SearchJobs' || url.pathname === '/cbcapply/SearchJobs/') &&
        only(['pipelineRecordsPerPage', 'pipelineOffset']) &&
        (!url.search ||
          (url.searchParams.get('pipelineRecordsPerPage') === '6' &&
            /^(?:0|[1-9]\d{0,2})$/.test(url.searchParams.get('pipelineOffset') ?? '')))) ||
      (!url.search && /^\/cbcapply\/PipelineDetail\/[a-zA-Z0-9%_-]+\/\d+$/.test(url.pathname))
  else if (site.adapter === 'oracle')
    allowed =
      ((url.pathname === new URL(site.url).pathname ||
        new RegExp('^' + new URL(site.url).pathname + '/job/\\d+$').test(url.pathname)) &&
        !url.search) ||
      (url.pathname === new URL(site.feed!).pathname &&
        only(['onlyData', 'expand', 'finder']) &&
        url.searchParams.get('onlyData') === 'true' &&
        url.searchParams.get('expand') === 'requisitionList' &&
        /^findReqs;siteNumber=CX_2001,facetsList=LOCATIONS,limit=100,keyword=Bermuda(?:,offset=\d{1,3})?$/.test(
          url.searchParams.get('finder') ?? '',
        ))
  else allowed = url.href === site.url
  if (!allowed) throw new Error(`Unsupported ${site.name} public listing route.`)
  if (site.adapter === 'deloitte' && /\/SearchJobs\/?$/.test(url.pathname)) {
    url.pathname = '/cbcapply/SearchJobs'
    if (url.searchParams.get('pipelineOffset') === '0') url.search = ''
  }
  // Stable ordering is needed for durable input identity and retries.
  url.searchParams.sort()
  return url.href
}
export function jobIsJson(id: JobSiteId, uri: string): boolean {
  const url = new URL(uri),
    site = jobSite(id)
  return (
    (site.adapter === 'wordpress' && url.pathname.includes('/jm-ajax/')) ||
    (site.adapter === 'bamboo' && /\/(?:list|detail)$/.test(url.pathname)) ||
    (site.adapter === 'workday' && url.pathname.includes('/wday/cxs/')) ||
    (site.adapter === 'oracle' && url.pathname.includes('/hcmRestApi/'))
  )
}
export async function fetchJobPage(
  id: JobSiteId,
  raw: string,
  signal: AbortSignal,
): Promise<Buffer> {
  const uri = jobUrl(id, raw),
    site = jobSite(id),
    url = new URL(uri),
    json = jobIsJson(id, uri)
  const post = site.adapter === 'workday' && url.pathname.endsWith('/jobs')
  const response = await fetch(uri, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
    redirect: 'error',
    credentials: 'omit',
    method: post ? 'POST' : 'GET',
    headers: {
      Accept: json ? 'application/json' : 'text/html',
      'User-Agent': 'Infomonk/0.11 public-job-check',
      ...(post ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(post
      ? {
          body: JSON.stringify({
            appliedFacets: url.searchParams.has('facet')
              ? { [url.searchParams.get('facet')!]: [url.searchParams.get('value')!] }
              : {},
            limit: 20,
            offset: Number(url.searchParams.get('offset') ?? 0),
            searchText: '',
          }),
        }
      : {}),
  })
  if (
    !response.ok ||
    !(json ? /json/i : /text\/html/i).test(response.headers.get('content-type') ?? '')
  ) {
    await response.body?.cancel().catch(() => {})
    throw new Error(
      `Job source unavailable or not ${json ? 'JSON' : 'HTML'} (HTTP ${response.status}). Previous accepted jobs remain unchanged.`,
    )
  }
  return Buffer.from(await readBodyCapped(response, 2 * 1024 * 1024))
}
