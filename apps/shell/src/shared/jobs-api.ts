export const JOB_SITES = [
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
] as const
export type JobSiteId = (typeof JOB_SITES)[number]['id']
export const APPLICATION_STATUSES = [
  'To review',
  'Saved',
  'Applied',
  'Interviewing',
  'Offer',
  'Declined',
  'Not pursuing',
] as const
