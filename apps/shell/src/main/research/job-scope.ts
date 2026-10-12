export function jobScope(title: string): string | null {
  if (/\b(?:actuar(?:y|ies|ial)|quantitative)\b/i.test(title))
    return 'Quantitative / actuarial — adjacent'
  if (/\b(?:data|business intelligence|analytics|model(?:er|ler)s?)\b/i.test(title))
    return 'Data / research'
  if (
    /\b(?:IT|ICT|systems?|technology|software|developer|cloud|cyber|network|infrastructure|server|storage|virtuali[sz]ation|managed services?|service desk|helpdesk|user experience|UX)\b/i.test(
      title,
    )
  )
    return 'Technology'
  if (/\banalysts?\b/i.test(title)) return 'Analyst — domain review'
  if (/\breinsurance professionals?\b/i.test(title)) return 'Broad recruiter pool — scope review'
  if (/\b(?:warehouse|logistics)\b/i.test(title))
    return /\b(?:customer service|operations|administrat(?:ion|ive)|office)\b/i.test(title)
      ? 'Mixed operational role — domain review'
      : null
  if (
    /\b(?:administrat(?:ors?|ion|ive)|account(?:ant|ants|ing)|bookkeep(?:er|ing)|office|secretar(?:y|ies)|paralegal|receptionist|clerk|finance|financial|controller|compliance|claims|operations|audit|tax|risk|supervision|human resources|HR|employee relations|payroll|procurement|purchasing|trust|fiduciary|corporate|treasury|secretarial|customer service|talent development|learning\s+(?:&|and)\s+talent|country head|project|relationship manager|brokerage|commercial director|business development|(?:executive|personal|underwriting) assistant)\b/i.test(
      title,
    )
  )
    return /chef|butcher|housekeep|caregiver|pool technician/i.test(title)
      ? 'Mixed advertisement — scope review'
      : 'Office / finance'
  return null
}
