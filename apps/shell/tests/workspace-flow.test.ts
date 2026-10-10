import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, cpSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkspaceStore } from '../src/main/workspace-store'
import { ResearchService } from '../src/main/research/service'
import { datasetPage } from '../src/main/research/pages'
import { quoteColumns, cell, hash } from '../src/main/research/extract'
import { relocateWorkspace } from '../src/main/workspace-portability'
import type { ResearchDataset } from '../src/shared/research-api'
const fixture = (name: string) => resolve('../../fixtures/infomonk/workspace-flow', name)
const expected = JSON.parse(readFileSync(fixture('expected.json'), 'utf8'))
const services: ResearchService[] = []
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-flow-')),
    workspace = new WorkspaceStore(root),
    project = await workspace.create({
      name: 'Supplier comparison',
      description: 'Synthetic use case',
      filePath: fixture('northwind.txt'),
      startKind: 'extractFiles',
    })
  await workspace.addSource(project.id, { path: fixture('cedar.docx') })
  await workspace.addSource(project.id, { path: fixture('maple.pdf') })
  const service = new ResearchService(root, workspace)
  services.push(service)
  const workflow = service.save(project.id, 'Supplier comparison', {
    kind: 'quotes',
    instructions: 'Compare CAD paper quotes',
    sourceIds: workspace.get(project.id).workspace.sources.map((s) => s.id),
    fields: quoteColumns.map((c) => c.id),
    countries: [],
    fromYear: 2023,
    toYear: 2024,
  })
  return { root, workspace, project, service, workflow }
}
const totals = (d: ResearchDataset) =>
  Object.fromEntries(
    d.tables
      .find((t) => t.id === 'quotes')!
      .rows.map((r) => [String(r.cells.quote_id.value), r.cells.total.value]),
  )
async function ready(service: ResearchService, p: string, w: string) {
  const r = service.run(p, w, false)
  await vi.waitFor(() => expect(service.store.run(r.id).status).toBe('review'))
  return r
}
afterEach(() => {
  for (const s of services.splice(0)) {
    s.close()
    s.store.close()
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('maintains independent expected facts across source versions, human overrides, review summaries and working-workbook reopen', async () => {
  const { workspace, project, service, workflow } = await setup()
  const first = await ready(service, project.id, workflow.id)
  expect(totals(service.store.run(first.id).candidate!)).toEqual(expected.initial)
  for (const row of service.store.run(first.id).candidate!.tables[0].rows) {
    const evidence = row.cells.total.evidence[0]
    expect((await service.evidence(project.id, evidence)).locator).toBe(
      expected.totalsLocations[evidence.sourceName],
    )
  }
  expect(service.summaries(workspace.list())[project.id]).toMatchObject({
    pendingReviews: 1,
    reviewRunId: first.id,
    acceptedRows: 0,
  })
  await service.publish(project.id, first.id, true, false)
  expect(service.summaries(workspace.list())[project.id]).toMatchObject({
    pendingReviews: 0,
    unresolvedCells: 1,
    acceptedRows: 6,
    acceptedTables: 2,
    reviewWorkflowId: workflow.id,
  })
  const data = service.store.accepted(workflow.id)!,
    maple = data.tables[0].rows.find((r) => r.cells.quote_id.value === 'Q-M001')!
  await service.correct(
    project.id,
    workflow.id,
    'quotes',
    maple.id,
    'total',
    108,
    expected.manualCorrection.reason,
  )
  expect(totals(service.store.accepted(workflow.id)!)).toEqual(expected.afterCorrection)
  expect(service.summaries(workspace.list())[project.id].unresolvedCells).toBe(0)
  const sources = workspace.get(project.id).workspace.sources
  const northwind = sources.find((s) => s.name === 'northwind.txt')!,
    oldHash = northwind.sha256!,
    oldBytes = readFileSync(northwind.snapshotPath!)
  await workspace.updateSource(project.id, northwind.id, fixture('northwind-v2.txt'))
  await workspace.updateSource(
    project.id,
    sources.find((s) => s.name === 'maple.pdf')!.id,
    fixture('maple-v2.txt'),
  )
  expect(readFileSync(northwind.snapshotPath!)).toEqual(oldBytes)
  expect(
    workspace.get(project.id).workspace.sources.find((s) => s.id === northwind.id)
      ?.previousVersions?.[0].sha256,
  ).toBe(oldHash)
  expect(service.summaries(workspace.list())[project.id].inputsChanged).toBe(true)
  expect(totals(service.store.accepted(workflow.id)!)).toEqual(expected.afterCorrection)
  const preview = await workspace.sourcePreviewPath(project.id, northwind.id, oldHash)
  expect(readFileSync(preview)).toEqual(oldBytes)
  const next = await ready(service, project.id, workflow.id)
  expect(totals(service.store.run(next.id).candidate!)).toEqual(expected.afterReviewedRefresh)
  const incoming = service.store
    .run(next.id)
    .candidate!.tables[0].rows.find((r) => r.cells.quote_id.value === 'Q-M001')!.cells.total
  expect(incoming.origin).toBe('manual')
  expect(await service.evidence(project.id, incoming.evidence[0])).toMatchObject({
    text: 'Total: 115.00',
    locator: expected.totalsLocations['maple-v2.txt'],
  })
  const path = await service.publish(project.id, next.id, true, false)
  expect(workspace.workbookPath(project.id)).toBe(path)
  expect(workspace.get(project.id).workspace.primaryWorkbook).not.toBe(path)
  expect(service.summaries(workspace.list())[project.id]).toMatchObject({
    inputsChanged: false,
    unresolvedCells: 0,
  })
  const overview = service.overview(project.id)
  expect(overview.outputCount).toBe(3)
  expect(overview.outputs.filter((o) => o.current).map((o) => o.revision)).toEqual([3])
  expect(overview.activity.some((e) => e.text.includes(expected.manualCorrection.reason))).toBe(
    true,
  )
  expect(overview.activity.some((e) => e.text.includes('Accepted revision 3'))).toBe(true)
  expect(() => service.overview('proj-000000000000')).toThrow('Project not found')
})

it('pins queued input versions and rejects stale publication after an update, including a late update during projection', async () => {
  const { service, workspace, project, workflow } = await setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(Error('Fixture cancelled')), {
            once: true,
          }),
        ),
    ),
  )
  const web = service.save(project.id, 'Blocked fixture', {
    ...workflow.config,
    kind: 'worldbank',
    sourceIds: [],
    countries: ['CAN'],
  })
  const blocker = service.run(project.id, web.id, false)
  await vi.waitFor(() => expect(service.store.run(blocker.id).status).toBe('acquiring'))
  const queued = service.run(project.id, workflow.id, false),
    source = workspace.get(project.id).workspace.sources[0]
  expect(service.store.inputs(queued.id).map((i) => i.sourceVersion)).toContain(source.sha256)
  await workspace.updateSource(project.id, source.id, fixture('northwind-v2.txt'))
  service.cancel(project.id, blocker.id)
  await vi.waitFor(() => expect(service.store.run(queued.id).status).toBe('review'))
  expect(totals(service.store.run(queued.id).candidate!)).toEqual(expected.initial)
  expect(service.detail(project.id, queued.id).inputsChanged).toBe(true)
  await expect(service.publish(project.id, queued.id, true, false)).rejects.toThrow(
    'Source inputs changed',
  )
  expect(service.store.accepted(workflow.id)).toBeNull()
  service.cancel(project.id, queued.id)
  const fresh = await ready(service, project.id, workflow.id)
  const projection = vi
    .spyOn(
      service as unknown as {
        projection(w: string, d: ResearchDataset, r: number): Promise<string>
      },
      'projection',
    )
    .mockImplementation(async () => {
      await workspace.updateSource(project.id, source.id, fixture('northwind.txt'))
      return 'synthetic-unreferenced.xlsx'
    })
  await expect(service.publish(project.id, fresh.id, true, false)).rejects.toThrow(
    'Source inputs changed',
  )
  expect(projection).toHaveBeenCalledOnce()
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(0)
})

it('filters review rows across full table pages and leaves accepted data intact', () => {
  const data: ResearchDataset = {
    schemaVersion: 1,
    issues: [],
    tables: [
      {
        id: 'quotes',
        name: 'Quotes',
        rowMeaning: 'One synthetic record',
        columns: [{ id: 'total', name: 'Total', type: 'number' }],
        rows: Array.from({ length: 230 }, (_, i) => ({
          id: hash(String(i)).slice(0, 24),
          cells: { total: cell(i >= 100 ? null : i) },
        })),
      },
    ],
  }
  expect(datasetPage(data, { needsReview: true })!.tables[0]).toMatchObject({
    totalRows: 130,
    allRows: 230,
    offset: 0,
  })
  expect(datasetPage(data, { needsReview: true, offset: 100 })!.tables[0].rows).toHaveLength(30)
  expect(datasetPage(data, { needsReview: true, offset: 100 })!.tables[0].rows[0].id).toBe(
    data.tables[0].rows[200].id,
  )
  expect(data.tables[0].rows).toHaveLength(230)
})

it('keeps every confirmed input pinned even when extraction deduplicates identical document bytes', async () => {
  const { workspace, project, service, workflow } = await setup()
  const duplicate = join(
    workspace.get(project.id).workspace.sources[0].snapshotPath!,
    '..',
    'duplicate.txt',
  )
  copyFileSync(fixture('northwind.txt'), duplicate)
  await workspace.addSource(project.id, { path: duplicate })
  service.save(
    project.id,
    workflow.name,
    {
      ...workflow.config,
      sourceIds: workspace.get(project.id).workspace.sources.map((s) => s.id),
    },
    workflow.id,
  )
  const run = await ready(service, project.id, workflow.id)
  expect(service.store.inputs(run.id)).toHaveLength(4)
  expect(service.store.run(run.id).candidate!.tables[0].rows).toHaveLength(3)
  const source = workspace
    .get(project.id)
    .workspace.sources.find((s) => s.name === 'duplicate.txt')!
  await workspace.updateSource(project.id, source.id, fixture('northwind-v2.txt'))
  await expect(service.publish(project.id, run.id, true, false)).rejects.toThrow(
    'Source inputs changed',
  )
  expect(service.store.accepted(workflow.id)).toBeNull()
})

it('relocates working workbooks and historical source snapshots and rejects choosing a preview as working data', async () => {
  const { root, workspace, project, service, workflow } = await setup()
  const run = await ready(service, project.id, workflow.id),
    path = await service.publish(project.id, run.id, true, false)
  const source = workspace.get(project.id).workspace.sources[0]
  await workspace.updateSource(project.id, source.id, fixture('northwind-v2.txt'))
  await workspace.addSource(project.id, { path })
  const workbookSource = workspace.get(project.id).workspace.sources.find((s) => s.uri === path)!
  const preview = await workspace.sourcePreviewPath(project.id, workbookSource.id)
  expect(() => workspace.rememberWorkbook(project.id, preview)).toThrow('project-owned workbook')
  if (process.platform === 'win32')
    expect(() => workspace.rememberWorkbook(project.id, preview.toUpperCase())).toThrow(
      'project-owned workbook',
    )
  const malformed = workspace.get(project.id)
  malformed.workspace.workingWorkbook = preview
  workspace.projects.updateWorkspace(project.id, malformed.workspace)
  expect(workspace.workbookPath(project.id)).toBe(malformed.workspace.primaryWorkbook)
  workspace.rememberWorkbook(project.id, path)
  service.close()
  service.store.close()
  services.splice(services.indexOf(service), 1)
  const copy = root + '-copy'
  cpSync(root, copy, { recursive: true, errorOnExist: true, force: false })
  relocateWorkspace(copy)
  const restored = new WorkspaceStore(copy)
  expect(restored.workbookPath(project.id)).not.toBe(path)
  expect(restored.workbookPath(project.id).startsWith(copy)).toBe(true)
  expect(
    restored
      .get(project.id)
      .workspace.sources[0].previousVersions![0].snapshotPath!.startsWith(copy),
  ).toBe(true)
  expect(
    readFileSync(await restored.sourcePreviewPath(project.id, source.id, source.sha256)),
  ).toEqual(readFileSync(source.snapshotPath!))
})
