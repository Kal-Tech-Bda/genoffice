import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ResearchStore } from '../src/main/research/store'
import { ResearchService } from '../src/main/research/service'
import { WorkspaceStore } from '../src/main/workspace-store'
import { extractQuote, hash, parseSource, quoteColumns } from '../src/main/research/extract'
import type { ResearchConfig } from '../src/shared/research-api'

const fixture = (name: string) => resolve('../../fixtures/infomonk/research', name)
const config: ResearchConfig = {
  kind: 'quotes',
  instructions: 'Review supplier quotes',
  sourceIds: [],
  fields: quoteColumns.map((c) => c.id),
  countries: [],
  fromYear: 2023,
  toYear: 2024,
}
const stores: ResearchStore[] = []
const services: ResearchService[] = []
async function dataset() {
  const bytes = readFileSync(fixture('valid.txt'))
  return extractQuote(
    await parseSource(bytes, 'valid.txt'),
    {
      sourceId: 'original',
      sourceVersion: hash(bytes),
      sourceName: 'valid.txt',
      uri: 'fixture:valid',
      retrievedAt: '2026-10-11T00:00:00Z',
    },
    config.fields,
  )
}
function store() {
  const value = new ResearchStore(
    join(mkdtempSync(join(tmpdir(), 'infomonk-journey-')), 'data.sqlite'),
  )
  stores.push(value)
  return value
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-journey-'))
  const workspace = new WorkspaceStore(root)
  const project = await workspace.create({
    name: 'Journey',
    description: '',
    filePath: fixture('valid.txt'),
  })
  const service = new ResearchService(root, workspace)
  services.push(service)
  const workflow = service.save(project.id, 'Quotes', {
    ...config,
    sourceIds: project.workspace!.sources.map((s) => s.id),
  })
  return { root, workspace, project, service, workflow }
}
async function ready(service: ResearchService, p: string, w: string, sample = false) {
  const run = service.run(p, w, sample)
  await vi.waitFor(() => expect(service.store.run(run.id).status).toBe('review'))
  return run
}
afterEach(() => {
  for (const service of services.splice(0)) {
    service.close()
    service.store.close()
  }
  for (const value of stores.splice(0)) value.close()
  vi.restoreAllMocks()
})

it('advances a reviewed sample directly to full execution, retaining sample evidence and fences', async () => {
  const { service, project, workflow } = await setup()
  const sample = await ready(service, project.id, workflow.id, true)
  const full = await ready(service, project.id, workflow.id)
  expect(service.store.run(sample.id)).toMatchObject({ status: 'obsolete', sample: true })
  expect(service.store.run(sample.id).candidate!.tables[0].rows[0].cells.total.value).toBe(125.5)
  expect(service.store.inputs(sample.id)).toHaveLength(1)
  expect(() => service.retry(project.id, sample.id)).toThrow('Only failed or cancelled')
  expect(() => service.run(project.id, workflow.id, false)).toThrow('current run')
  await service.publish(project.id, full.id, true, false)
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(1)
})

it('does not let scheduled execution or another sample supersede review; rolls back failed queue transitions', async () => {
  const value = store(),
    workflow = value.save('project', 'Quotes', config)
  const sample = value.queue(workflow.id, true)
  expect(() => value.queue(workflow.id, false, [], true)).toThrow('current run')
  value.review(sample.id, await dataset(), { complete: 1, failed: 0, total: 1 })
  expect(() => value.queue(workflow.id, true, [], true)).toThrow('current run')
  expect(() => value.queue(workflow.id, false)).toThrow('current run')
  value.db.exec(
    "CREATE TRIGGER fail_full BEFORE INSERT ON runs WHEN NEW.sample=0 BEGIN SELECT RAISE(ABORT,'fixture queue failure'); END;",
  )
  expect(() => value.queue(workflow.id, false, [], true)).toThrow('fixture queue failure')
  expect(value.run(sample.id).status).toBe('review')
  expect(value.run(sample.id).events.some((e) => e.status === 'obsolete')).toBe(false)
})

it('blocks partial mixed-source publication and allows explicit scope repair without altering accepted data', async () => {
  const { root, service, workspace, project, workflow } = await setup()
  const first = await ready(service, project.id, workflow.id)
  await service.publish(project.id, first.id, true, false)
  const invalid = join(root, 'unsupported.txt')
  writeFileSync(invalid, 'Meeting notes\nNo labeled supplier quote exists in this document.')
  await workspace.addSource(project.id, { path: invalid })
  const sources = workspace.get(project.id).workspace.sources
  service.save(
    project.id,
    'Quotes',
    { ...workflow.config, sourceIds: sources.map((s) => s.id) },
    workflow.id,
  )
  const mixed = await ready(service, project.id, workflow.id)
  expect(service.store.run(mixed.id).coverage).toEqual({ total: 2, complete: 1, failed: 1 })
  await expect(service.publish(project.id, mixed.id, true, true)).rejects.toThrow(
    'Incomplete coverage',
  )
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(1)
  service.save(project.id, 'Quotes', workflow.config, workflow.id)
  expect(service.store.run(mixed.id).status).toBe('obsolete')
  const repaired = await ready(service, project.id, workflow.id)
  await service.publish(project.id, repaired.id, true, false)
  expect(service.store.accepted(workflow.id)!.tables[0].rows[0].cells.total.value).toBe(125.5)
})

it.each(['quotes', 'line_items'])(
  'retains the complete absent quote relationship when a %s row has a correction',
  async (tableId) => {
    const value = store(),
      workflow = value.save('project', 'Quotes', config)
    const data = await dataset(),
      first = value.queue(workflow.id, false)
    value.review(first.id, data, { total: 1, complete: 1, failed: 0 })
    value.publish(first.id, value.prepare(first.id, true, false), 'r1.xlsx')
    const corrected = structuredClone(data),
      table = corrected.tables.find((t) => t.id === tableId)!
    const column = tableId === 'quotes' ? 'total' : 'quantity'
    table.rows[0].cells[column] = { ...table.rows[0].cells[column], value: 9, origin: 'manual' }
    value.correct(
      workflow.id,
      tableId,
      table.rows[0].id,
      column,
      9,
      'Reviewed correction',
      corrected,
      'r2.xlsx',
      1,
    )
    const absent = value.queue(workflow.id, false)
    value.review(
      absent.id,
      { schemaVersion: 1, tables: [], issues: [] },
      { total: 1, complete: 1, failed: 0 },
    )
    const retained = value.prepare(absent.id, true, true)
    expect(retained.tables.find((t) => t.id === 'quotes')!.rows).toHaveLength(1)
    expect(retained.tables.find((t) => t.id === 'line_items')!.rows).toHaveLength(2)
    expect(retained.tables.find((t) => t.id === tableId)!.rows[0].cells[column].value).toBe(9)
  },
)

it('rejects record-key corrections before writing an XLSX or revision, but permits ordinary reviewed facts', async () => {
  const { service, project, workflow } = await setup()
  const first = await ready(service, project.id, workflow.id)
  await service.publish(project.id, first.id, true, false)
  const data = service.store.accepted(workflow.id)!
  for (const table of data.tables)
    await expect(
      service.correct(
        project.id,
        workflow.id,
        table.id,
        table.rows[0].id,
        'quote_id',
        'Q-NEW',
        'Change key',
      ),
    ).rejects.toThrow('Record identity')
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(1)
  expect(service.store.corrections(workflow.id)).toHaveLength(0)
  await service.correct(
    project.id,
    workflow.id,
    'quotes',
    data.tables[0].rows[0].id,
    'total',
    130,
    'Confirmed total',
  )
  expect(service.store.accepted(workflow.id)!.tables[0].rows[0].cells.total.value).toBe(130)
})

it('copies workflow intent into an independent project with input configuration as the next step', async () => {
  const { service, workspace, project, workflow } = await setup()
  service.store.schedule(workflow.id, 15, false)
  const id = await service.createFrom(
    project.id,
    workflow.id,
    'Next supplier batch',
    'Independent quotes',
  )
  const copied = service.state(id).workflows[0]
  expect(workspace.get(id).workspace.startKind).toBe('extractFiles')
  expect(copied).toMatchObject({
    acceptedRevision: 0,
    scheduleMinutes: null,
    config: { sourceIds: [], instructions: config.instructions },
  })
  expect(service.store.accepted(copied.id)).toBeNull()
  expect(() => service.run(id, copied.id, false)).toThrow('Choose quote inputs')
  await workspace.addSource(id, { path: fixture('valid.txt') })
  service.save(
    id,
    copied.name,
    { ...copied.config, sourceIds: workspace.get(id).workspace.sources.map((s) => s.id) },
    copied.id,
  )
  const full = await ready(service, id, copied.id)
  await service.publish(id, full.id, true, false)
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(0)
  expect(service.store.workflow(workflow.id).scheduleMinutes).toBe(15)
})

it('rejects invalid manual facts without advancing the accepted revision or clearing review history', async () => {
  const { service, project, workflow } = await setup()
  const first = await ready(service, project.id, workflow.id)
  await service.publish(project.id, first.id, true, false)
  const data = service.store.accepted(workflow.id)!
  const quote = data.tables[0].rows[0],
    item = data.tables[1].rows[0]
  for (const [table, row, column, value] of [
    ['quotes', quote.id, 'total', -1],
    ['line_items', item.id, 'quantity', -1],
    ['line_items', item.id, 'unit_price', -1],
    ['quotes', quote.id, 'currency', 'CAD$'],
    ['quotes', quote.id, 'country_code', 'Canada'],
    ['quotes', quote.id, 'date', '2026-02-30'],
  ] as const)
    await expect(
      service.correct(
        project.id,
        workflow.id,
        table,
        row,
        column,
        value,
        'Synthetic invalid correction',
      ),
    ).rejects.toThrow('Correction must')
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(1)
  expect(service.store.corrections(workflow.id)).toHaveLength(0)
  expect(service.store.accepted(workflow.id)).toEqual(data)
  await service.correct(
    project.id,
    workflow.id,
    'quotes',
    quote.id,
    'total',
    0,
    'Confirmed free quote',
  )
  expect(service.store.accepted(workflow.id)!.tables[0].rows[0].cells.total.value).toBe(0)
})
