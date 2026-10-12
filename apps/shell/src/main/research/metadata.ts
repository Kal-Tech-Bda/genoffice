import type { ResearchDataset } from '../../shared/research-api'

export const RESEARCH_METADATA_LIMIT = 16 * 1024 * 1024
export function researchMetadata(
  dataset: ResearchDataset,
  workflowId: string,
  revision: number,
): string {
  return JSON.stringify({
    version: 1,
    workflowId,
    revision,
    dataset,
    attribution: dataset.tables.some((t) => t.id === 'jobs')
      ? 'Public career-site listings from the explicitly selected sources. Original URLs, retrieval times, snapshot versions and locators are recorded in cell evidence. Listing presence does not guarantee availability. Personal application status and notes are user-maintained; human changes are labeled manual.'
      : dataset.tables.some((t) =>
            t.rows.some((r) =>
              Object.values(r.cells).some((c) =>
                c.evidence.some((e) => e.method === 'worldbank-SP.POP.TOTL-v1'),
              ),
            ),
          )
        ? 'World Bank, World Development Indicators, SP.POP.TOTL; original URLs and retrieval times are recorded in cell evidence. CC BY 4.0 subject to source terms. Human changes are labeled manual.'
        : dataset.tables.some((t) =>
              t.rows.some((r) =>
                Object.values(r.cells).some((c) =>
                  c.evidence.some((e) => e.method === 'html-tables-v1'),
                ),
              ),
            )
          ? 'Captured public HTML or project-provided HTML snapshots; original URLs, retrieval times, source versions and cell locators are recorded in evidence. Static page/table scope only; source terms apply. Context notes remain review issues. Human changes are labeled manual.'
          : 'User-provided document snapshots; source versions and locators are recorded in cell evidence. Human changes are labeled manual.',
    tables: dataset.tables.map((t) => ({
      id: t.id,
      name: t.name,
      columns: t.columns,
      ...(t.id.startsWith('html_') ? { headerMode: 'labels' } : {}),
    })),
  })
}
export function checkedResearchMetadata(
  dataset: ResearchDataset,
  workflowId: string,
  revision: number,
): string {
  const serialized = researchMetadata(dataset, workflowId, revision)
  if (serialized.length > RESEARCH_METADATA_LIMIT)
    throw new Error(
      'Research evidence exceeds the supported workbook size. Split the input batch before publishing; accepted data is unchanged.',
    )
  return serialized
}
