import { afterEach, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { ResearchService } from '../src/main/research/service'
import { WorkspaceStore } from '../src/main/workspace-store'
import * as extraction from '../src/main/research/extract'
import { READINESS_FINDING_LIMIT } from '../src/main/research/readiness'
const fixture = (name: string) => resolve('../../fixtures/infomonk/research', name)
const services: ResearchService[] = []
async function setup(names = ['valid.txt']) {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-readiness-'))
  const workspace = new WorkspaceStore(root)
  const project = await workspace.create({
    name: 'Readiness',
    description: '',
    filePath: fixture(names[0]),
  })
  for (const name of names.slice(1)) await workspace.addSource(project.id, { path: fixture(name) })
  const service = new ResearchService(root, workspace)
  services.push(service)
  const config = {
    kind: 'quotes' as const,
    instructions: 'Review synthetic quote inputs',
    sourceIds: workspace.get(project.id).workspace.sources.map((s) => s.id),
    fields: extraction.quoteColumns.map((c) => c.id),
    countries: [],
    fromYear: 2023,
    toYear: 2024,
  }
  const workflow = service.save(project.id, 'Quotes', config)
  return { root, workspace, project, service, workflow }
}
afterEach(() => {
  for (const s of services.splice(0)) {
    s.close()
    s.store.close()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reports ready, missing facts and blocked families with locators without creating a run or changing project/source data', async () => {
  const { root, workspace, project, service, workflow } = await setup([
    'valid.txt',
    'missing.md',
    'unsupported.txt',
  ])
  const before = workspace.get(project.id)
  const fetch = vi.fn(() => {
    throw Error('No network in input readiness')
  })
  vi.stubGlobal('fetch', fetch)
  const result = await service.readiness(project.id, workflow.id)
  expect(result).toMatchObject({
    readyToRun: false,
    configVersion: 1,
    counts: { selected: 3, unique: 3, ready: 1, review: 1, blocked: 1, duplicates: 0 },
  })
  expect(result.inputs[0]).toMatchObject({ quoteId: 'Q-100', status: 'ready', findingCount: 0 })
  expect(result.inputs[1].findings.find((f) => f.field === 'date')!.excerpts[0]).toMatchObject({
    locator: 'Text line 4',
    text: 'Date: 2026-02-31',
  })
  expect(result.inputs[1].findings.find((f) => f.field === 'total')!.message).toContain(
    'Not stated',
  )
  expect(result.inputs[2].findings[0].message).toContain('Unsupported document family')
  expect(workspace.get(project.id)).toEqual(before)
  expect(service.state(project.id).runs).toEqual([])
  expect(service.store.accepted(workflow.id)).toBeNull()
  expect(existsSync(join(root, 'projects', project.id, 'workspace', 'research'))).toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it('deduplicates identical bytes, warns about conflicting business keys and reuses verified parsing for execution', async () => {
  const { root, workspace, project, service, workflow } = await setup(['valid.txt', 'conflict.txt'])
  const duplicate = join(root, 'identical-copy.txt')
  copyFileSync(fixture('valid.txt'), duplicate)
  await workspace.addSource(project.id, { path: duplicate })
  const updated = service.save(
    project.id,
    workflow.name,
    { ...workflow.config, sourceIds: workspace.get(project.id).workspace.sources.map((s) => s.id) },
    workflow.id,
  )
  const parse = vi.spyOn(extraction, 'parseSource')
  const result = await service.readiness(project.id, workflow.id)
  expect(result).toMatchObject({
    readyToRun: true,
    counts: { selected: 3, unique: 2, ready: 0, review: 2, blocked: 0, duplicates: 1 },
  })
  expect(result.inputs[2].duplicateOf).toBe(result.inputs[0].sourceId)
  expect(result.inputs[0].findings[0].message).toContain('differing total')
  expect(result.inputs[0].findings[0].excerpts.map((e) => e.text)).toEqual([
    'Total: 125.50',
    'Total: 125.50',
    'Total: 130.00',
  ])
  expect(parse).toHaveBeenCalledTimes(2)
  await service.readiness(project.id, workflow.id)
  expect(parse).toHaveBeenCalledTimes(2)
  const run = service.run(project.id, updated.id, false)
  await vi.waitFor(() => expect(service.store.run(run.id).status).toBe('review'))
  expect(parse).toHaveBeenCalledTimes(2)
  expect(service.store.run(run.id).coverage).toEqual({ total: 2, complete: 2, failed: 0 })
  expect(service.store.run(run.id).candidate!.tables[0].rows[0].cells.total.value).toBeNull()
})

it('requires a single nonempty record key but permits missing non-key facts for reviewed publication', async () => {
  const { root, workspace, project, service, workflow } = await setup(['missing.md'])
  expect((await service.readiness(project.id, workflow.id)).readyToRun).toBe(true)
  const path = join(root, 'missing-key.txt')
  writeFileSync(path, 'Supplier Quote\nQuote ID:\nSupplier: No key\nCurrency: CAD\nTotal: 10')
  await workspace.addSource(project.id, { path })
  service.save(
    project.id,
    workflow.name,
    { ...workflow.config, sourceIds: workspace.get(project.id).workspace.sources.map((s) => s.id) },
    workflow.id,
  )
  const result = await service.readiness(project.id, workflow.id)
  expect(result.readyToRun).toBe(false)
  expect(result.inputs[1].findings[0]).toMatchObject({ severity: 'blocked', field: 'quote_id' })
  expect(service.state(project.id).runs).toEqual([])
  const diagnostic = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(diagnostic.id).status).toBe('review'))
  await expect(service.publish(project.id, diagnostic.id, true, false)).rejects.toThrow(
    'Quote ID prevents publication',
  )
  expect(() =>
    service.store.publish(
      diagnostic.id,
      service.store.run(diagnostic.id).candidate!,
      'blocked.xlsx',
    ),
  ).toThrow('Quote ID prevents publication')
  expect(service.store.accepted(workflow.id)).toBeNull()
  writeFileSync(
    path,
    'Supplier Quote\nQuote ID: Q-A\nQuote ID: Q-B\nSupplier: Conflicting keys\nCurrency: CAD\nTotal: 10',
  )
  await workspace.updateSource(project.id, workspace.get(project.id).workspace.sources[1].id, path)
  const conflicting = (await service.readiness(project.id, workflow.id)).inputs[1]
  expect(conflicting).toMatchObject({ status: 'blocked', quoteId: null })
  expect(
    conflicting.findings.find((f) => f.field === 'quote_id')!.excerpts.map((e) => e.text),
  ).toEqual(['Quote ID: Q-A', 'Quote ID: Q-B'])
})

it('verifies snapshot bytes even when parsing is cached and leaves accepted data unchanged on integrity failure', async () => {
  const { workspace, project, service, workflow } = await setup()
  await service.readiness(project.id, workflow.id)
  const run = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(run.id).status).toBe('review'))
  await service.publish(project.id, run.id, true, false)
  const accepted = service.store.accepted(workflow.id)
  const snapshot = workspace.get(project.id).workspace.sources[0].snapshotPath!
  writeFileSync(snapshot, 'Tampered synthetic snapshot')
  const result = await service.readiness(project.id, workflow.id)
  expect(result.inputs[0].status).toBe('blocked')
  expect(result.inputs[0].findings[0].message).toContain('integrity failure')
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(1)
  expect(service.store.accepted(workflow.id)).toEqual(accepted)
})

it('rejects checks made stale by an input update or a configuration edit during parsing and releases its concurrency gate', async () => {
  const { workspace, project, service, workflow } = await setup()
  let release!: (bytes: Buffer) => void
  const read = workspace.boundedRead.bind(workspace)
  vi.spyOn(workspace, 'boundedRead').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const checking = service.readiness(project.id, workflow.id)
  const rejected = expect(checking).rejects.toThrow('changed while checking')
  await expect(service.readiness(project.id, workflow.id)).rejects.toThrow(
    'Another input readiness',
  )
  const old = workspace.get(project.id).workspace.sources[0]
  const bytes = await read(old.snapshotPath!)
  await workspace.updateSource(project.id, old.id, fixture('conflict.txt'))
  release(bytes)
  await rejected
  expect((await service.readiness(project.id, workflow.id)).inputs[0].status).toBe('review')
  vi.spyOn(extraction, 'parseSource').mockImplementationOnce(async (bytes, name) => {
    service.save(
      project.id,
      workflow.name,
      { ...workflow.config, instructions: 'Changed during check' },
      workflow.id,
    )
    return {
      units: bytes
        .toString('utf8')
        .split('\n')
        .map((text, i) => ({ text, locator: `Text line ${i + 1}` })),
      method: name,
    }
  })
  // Use a new content version so this check parses rather than reading the cache.
  await workspace.updateSource(project.id, old.id, fixture('missing.md'))
  await expect(service.readiness(project.id, workflow.id)).rejects.toThrow('changed while checking')
  expect(service.state(project.id).runs).toEqual([])
})

it('finds conflicting numbered items and bounds readiness findings/excerpt payloads', async () => {
  const { root, workspace, project, service, workflow } = await setup()
  const path = join(root, 'item-conflicts.txt')
  writeFileSync(
    path,
    readFileSync(fixture('valid.txt'), 'utf8') +
      '\nItem 1 | Alternate paper | 7 | 20.00\n' +
      Array.from({ length: 100 }, (_, i) => `Item ${i + 3} | Invalid item`).join('\n'),
  )
  await workspace.updateSource(project.id, workspace.get(project.id).workspace.sources[0].id, path)
  const result = await service.readiness(project.id, workflow.id)
  expect(result.readyToRun).toBe(true)
  expect(result.inputs[0].status).toBe('review')
  expect(result.inputs[0].findings.some((f) => f.message.includes('Line item quantity'))).toBe(true)
  expect(result.inputs[0].findingCount).toBeGreaterThan(100)
  expect(result.inputs[0].findings).toHaveLength(READINESS_FINDING_LIMIT)
  expect(JSON.stringify(result).length).toBeLessThan(20_000)
})

it('validates project/task/scope boundaries without making public requests', async () => {
  const { workspace, project, service, workflow } = await setup()
  const other = await workspace.create({ name: 'Other', description: '' })
  await expect(service.readiness(other.id, workflow.id)).rejects.toThrow(
    'not found in this project',
  )
  const web = service.save(project.id, 'Public', {
    ...workflow.config,
    kind: 'worldbank',
    countries: ['CAN'],
  })
  await expect(service.readiness(project.id, web.id)).rejects.toThrow('local supplier quote')
  const empty = service.save(project.id, 'Empty', { ...workflow.config, sourceIds: [] })
  expect(await service.readiness(project.id, empty.id)).toMatchObject({
    readyToRun: false,
    counts: { selected: 0, unique: 0 },
  })
  const malformed = service.store.save(project.id, 'Too many', {
    ...workflow.config,
    sourceIds: Array.from({ length: 21 }, (_, i) => String(i)),
  })
  await expect(service.readiness(project.id, malformed.id)).rejects.toThrow('at most 20')
})

it('uses inherited DOCX/PDF parsing and flags unreadable documents before execution', async () => {
  const { service, project, workflow } = await setup(['valid.docx', 'valid.pdf', 'broken.pdf'])
  const result = await service.readiness(project.id, workflow.id)
  expect(result.inputs[0].quoteId).toBe('Q-100')
  expect(result.inputs[1].quoteId).toBe('Q-100')
  expect(result.inputs[2].status).toBe('blocked')
  expect(
    result.inputs[0].findings
      .flatMap((f) => f.excerpts)
      .some((e) => e.locator.startsWith('DOCX body element')),
  ).toBe(true)
  expect(
    result.inputs[1].findings
      .flatMap((f) => f.excerpts)
      .some((e) => e.locator.startsWith('PDF page')),
  ).toBe(true)
  expect(service.state(project.id).runs).toEqual([])
})

it('identifies cross-source item disagreements even when quote header facts match', async () => {
  const { root, workspace, project, service, workflow } = await setup()
  const path = join(root, 'different-items.txt')
  writeFileSync(
    path,
    readFileSync(fixture('valid.txt'), 'utf8').replace('Paper | 5 |', 'Paper | 7 |'),
  )
  await workspace.addSource(project.id, { path })
  service.save(
    project.id,
    workflow.name,
    { ...workflow.config, sourceIds: workspace.get(project.id).workspace.sources.map((s) => s.id) },
    workflow.id,
  )
  const result = await service.readiness(project.id, workflow.id)
  expect(result.readyToRun).toBe(true)
  expect(result.inputs[0].findings[0].message).toContain('differing Line items quantity')
  expect(result.inputs[0].findings[0].excerpts.map((e) => e.text)).toEqual([
    'Item 1 | Paper | 5 | 20.00',
    'Item 1 | Paper | 7 | 20.00',
  ])
})
