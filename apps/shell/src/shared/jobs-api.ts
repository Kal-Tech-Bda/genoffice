export const JOB_SITES = [
  {
    id: 'linkedin',
    name: 'LinkedIn Bermuda (partial public guest search)',
    url: 'https://www.linkedin.com/jobs/search/?keywords=&location=Bermuda',
    adapter: 'linkedin',
  },
  {
    id: 'bma',
    name: 'Bermuda Monetary Authority',
    url: 'https://jobs.jobvite.com/bmacareers/jobs',
  },
  {
    id: 'coralisle',
    name: 'Coralisle Group',
    url: 'https://fs-320.my.salesforce-sites.com/recruit/fRecruit__ApplyJobList',
  },
  {
    id: 'expertise',
    name: 'Expertise Group',
    url: 'https://www.expertisegroup.com/available-jobs',
  },
  {
    id: 'jobsinbda',
    name: 'JobsInBDA / Royal Gazette',
    url: 'https://www.jobsinbda.com/',
    feed: 'https://www.jobsinbda.com/jm-ajax/get_listings/?page=1&per_page=100',
    adapter: 'wordpress',
  },
  {
    id: 'hamilton',
    name: 'Hamilton Recruitment',
    url: 'https://hamilton-recruitment.breezy.hr/',
    adapter: 'breezy',
  },
  {
    id: 'ccs',
    name: 'CCS Group',
    url: 'https://www.ccs.bm/careers/',
    employer: 'CCS Group',
    adapter: 'ccs',
  },
  {
    id: 'clarien',
    name: 'Clarien Bank',
    url: 'https://clarienbank.com/careers/',
    employer: 'Clarien Bank Limited',
    adapter: 'clarien',
  },
  {
    id: 'onecomm',
    name: 'One Communications',
    url: 'https://onecomm.bamboohr.com/careers',
    feed: 'https://onecomm.bamboohr.com/careers/list',
    employer: 'One Communications',
    adapter: 'bamboo',
  },
  {
    id: 'skyport',
    name: 'Bermuda Skyport',
    url: 'https://bermudaskyport.bamboohr.com/careers',
    feed: 'https://bermudaskyport.bamboohr.com/careers/list',
    employer: 'Bermuda Skyport',
    adapter: 'bamboo',
  },
  {
    id: 'artex',
    name: 'Artex Talent Solutions (formerly Frontier)',
    url: 'https://phe.tbe.taleo.net/phe03/ats/careers/v2/searchResults?org=FRONTIER&cws=40',
    adapter: 'taleo',
  },
  {
    id: 'island',
    name: 'Island Paradise Recruitment',
    url: 'https://www.islandparadiserecruitment.co.uk/job-openings',
    adapter: 'island',
  },
  {
    id: 'deloitte',
    name: 'Deloitte Caribbean and Bermuda',
    url: 'https://talentsourcing.deloitte.com/cbcapply/SearchJobs',
    employer: 'Deloitte',
    adapter: 'deloitte',
  },
  {
    id: 'axis',
    name: 'AXIS',
    url: 'https://axiscapital.wd1.myworkdayjobs.com/axiscareers',
    feed: 'https://axiscapital.wd1.myworkdayjobs.com/wday/cxs/axiscapital/axiscareers/jobs',
    employer: 'AXIS',
    adapter: 'workday',
  },
  {
    id: 'arch',
    name: 'Arch Capital',
    url: 'https://archgroup.wd1.myworkdayjobs.com/careers',
    feed: 'https://archgroup.wd1.myworkdayjobs.com/wday/cxs/archgroup/careers/jobs',
    employer: 'Arch Capital Group',
    adapter: 'workday',
  },
  {
    id: 'hiscox',
    name: 'Hiscox',
    url: 'https://hiscox.wd3.myworkdayjobs.com/Hiscox_External_Site',
    feed: 'https://hiscox.wd3.myworkdayjobs.com/wday/cxs/hiscox/Hiscox_External_Site/jobs',
    employer: 'Hiscox',
    adapter: 'workday',
  },
  {
    id: 'athora',
    name: 'Athora',
    url: 'https://athora.wd3.myworkdayjobs.com/athora-careers',
    feed: 'https://athora.wd3.myworkdayjobs.com/wday/cxs/athora/athora-careers/jobs',
    employer: 'Athora',
    adapter: 'workday',
  },
  {
    id: 'everest',
    name: 'Everest',
    url: 'https://wd5.myworkdaysite.com/recruiting/everestre/careers',
    feed: 'https://wd5.myworkdaysite.com/wday/cxs/everestre/careers/jobs',
    employer: 'Everest',
    adapter: 'workday',
  },
  {
    id: 'chubb',
    name: 'Chubb Bermuda',
    url: 'https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001',
    feed: 'https://fa-ewgu-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/11.13.18.05/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=CX_2001,facetsList=LOCATIONS,limit=100,keyword=Bermuda',
    employer: 'Chubb',
    adapter: 'oracle',
  },
] as const
export type JobSiteId = (typeof JOB_SITES)[number]['id']
export type JobSite = {
  id: JobSiteId
  name: string
  url: string
  feed?: string
  employer?: string
  adapter?: string
}
// These are discovery targets, not claims of completed acquisition or zero vacancies.
export const JOB_DISCOVERY_SITES = [
  [
    'jobfinder',
    'BermudaJobFinder (public board; adapter pending)',
    'https://www.bermudajobfinder.com/',
  ],
  ['jobconnect', 'Bermuda Job Connect', 'https://www.bermudajobconnect.bm/'],
  ['government', 'Government careers', 'https://www.govtcareers.gov.bm/'],
  ['platinum', 'Platinum Group', 'https://www.platinumgroup.bm/jobs/'],
  ['pwc-search', 'PwC Executive Search', 'https://www.pwc.com/bm/bermudatopjobs'],
  ['pwc', 'PwC Bermuda careers', 'https://www.pwc.com/bm/en/careers/experienced/job-search.html'],
  [
    'kpmg',
    'KPMG Bermuda',
    'https://kpmg.com/bm/en/careers/experienced-hires/employment-opportunities.html',
  ],
  [
    'bhb',
    'Bermuda Hospitals Board',
    'https://bermudahospitals.bm/work-at-bhb/bhb-jobs-now/external-applicants/',
  ],
  ['butterfield', 'Butterfield', 'https://www.butterfieldgroup.com/careers'],
  ['hsbc', 'HSBC Bermuda', 'https://www.about.hsbc.bm/careers'],
  ['renre', 'RenaissanceRe', 'https://www.renre.com/careers/'],
  ['aspen', 'Aspen', 'https://www.aspen.co/'],
  ['sirius', 'SiriusPoint', 'https://www.siriuspt.com/'],
  ['fortitude', 'Fortitude Re', 'https://fortitude-re.com/'],
  ['athene', 'Athene', 'https://www.athene.com/'],
  ['fireminds', 'Fireminds', 'https://www.fireminds.com/'],
  ['digicel', 'Digicel', 'https://careers.digicelgroup.com/'],
  ['ey', 'EY', 'https://www.ey.com/en_gl/careers'],
  ['conyers', 'Conyers', 'https://www.conyers.com/about-us/careers/'],
  ['appleby', 'Appleby', 'https://www.applebyglobal.com/careers/'],
  ['belco', 'BELCO', 'https://belco.bm/opportunities/'],
  ['saltus', 'Saltus', 'https://www.saltus.bm/explore/careers'],
  ['hprincess', 'Hamilton Princess / Accor', 'https://www.thehamiltonprincess.com/careers/'],
  ['bes', 'Bermuda Executive Services', 'https://www.bermudaemployment.com/'],
].map(([id, name, url]) => ({ id, name, url }))
export const APPLICATION_STATUSES = [
  'To review',
  'Saved',
  'Applied',
  'Interviewing',
  'Offer',
  'Declined',
  'Not pursuing',
] as const
