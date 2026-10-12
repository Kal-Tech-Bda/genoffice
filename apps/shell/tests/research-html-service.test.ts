import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { WorkspaceStore } from '../src/main/workspace-store'
import { ResearchService } from '../src/main/research/service'
import { hash, processingVersion } from '../src/main/research/extract'
import type { HtmlTableDiscovery, ResearchConfig } from '../src/shared/research-api'

const { acquire } = vi.hoisted(() => ({ acquire: vi.fn() }))
vi.mock('../src/main/research/table-fetch', async (original) => ({
  ...(await original<typeof import('../src/main/research/table-fetch')>()),
  fetchTableSource: acquire,
}))
const services: ResearchService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) {
    service.close()
    await vi.waitFor(() => expect((service as unknown as { running: boolean }).running).toBe(false))
    service.store.close()
  }
  vi.restoreAllMocks()
  acquire.mockReset()
})

const table = (count = 205, change = '', headers = '<th>ID</th><th>Value</th>') =>
  `<h2>Published catalogue</h2><table><tr>${headers}</tr>${Array.from(
    { length: count },
    (_, i) =>
      `<tr><td>${String(i).padStart(6, '0')}</td><td>${i === 153 && change ? change : `Item ${i}`}</td></tr>`,
  ).join('')}</table>`
const page = (content = table(), stamp = '') =>
  Buffer.from(`<!doctype html><html><body>${content}<!-- ${stamp} --></body></html>`)
function mockPage(bytes: Buffer, at = '2026-10-12T12:00:00.000Z') {
  acquire.mockResolvedValue({ bytes, uri: 'https://example.test/catalogue', retrievedAt: at })
}
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-html-service-')),
    workspace = new WorkspaceStore(root),
    project = await workspace.create({
      name: 'Captured tables',
      description: 'Synthetic source fixture',
    }),
    service = new ResearchService(root, workspace)
  services.push(service)
  return { root, workspace, project, service }
}
function config(
  discovery: HtmlTableDiscovery,
  input: { url?: string; sourceId?: string } = { url: 'https://example.test/catalogue' },
): ResearchConfig {
  return {
    kind: 'htmlTables',
    instructions: 'Maintain every source catalogue row with exact text',
    sourceIds: [],
    fields: [],
    countries: [],
    fromYear: 2026,
    toYear: 2026,
    htmlTables: {
      ...input,
      captureId: discovery.captureId,
      selections: discovery.tables.map((t) => ({ tableId: t.id, keyColumns: ['column_1'] })),
    },
  }
}
async function terminal(service: ResearchService, id: string, status = 'review') {
  await vi.waitFor(() => expect(service.store.run(id).status).toBe(status))
  await vi.waitFor(() => expect((service as unknown as { running: boolean }).running).toBe(false))
  return service.store.run(id)
}

it('discovers once, converts all 205 rows, fences samples, publishes exact text and re-fetches each later refresh', async () => {
  const { project, service } = await fixture()
  mockPage(page())
  const discovery = await service.discoverTables(project.id, {
    url: 'https://example.test/catalogue',
  })
  expect(discovery.tables[0]).toMatchObject({ supported: true, rowCount: 205 })
  expect(discovery.tables[0].sample).toHaveLength(10)
  expect(discovery.sourceVersion).toBe(hash(page()))
  const workflow = service.save(project.id, 'Catalogue', config(discovery))
  expect(processingVersion(workflow.config)).toBe('html-tables-1/schema-1')
  const sample = service.run(project.id, workflow.id, true)
  expect((await terminal(service, sample.id)).candidate!.tables[0].rows).toHaveLength(20)
  await expect(service.publish(project.id, sample.id, true, false)).rejects.toThrow(
    'Samples cannot publish',
  )
  expect(service.store.accepted(workflow.id)).toBeNull()
  const full = service.run(project.id, workflow.id, false),
    run = await terminal(service, full.id)
  expect(service.store.run(sample.id).status).toBe('obsolete')
  expect(acquire).toHaveBeenCalledTimes(1)
  expect(run.candidate!.tables[0].rows).toHaveLength(205)
  expect(service.detail(project.id, full.id).candidate!.tables[0].rows).toHaveLength(100)
  expect(
    service.detail(project.id, full.id, { offset: 200 }).candidate!.tables[0].rows[4].cells.column_1
      .value,
  ).toBe('000204')
  const proof = run.candidate!.tables[0].rows[153].cells.column_2.evidence[0]
  await expect(service.evidence(project.id, proof)).resolves.toMatchObject({ text: 'Item 153' })
  await expect(
    service.evidence(project.id, { ...proof, excerpt: 'Invented value' }),
  ).rejects.toThrow('locator')
  const workbook = await service.publish(project.id, full.id, true, false),
    zip = await JSZip.loadAsync(readFileSync(workbook)),
    metadata = JSON.parse(await zip.file('infomonk/research.json')!.async('string'))
  expect(metadata.dataset.tables[0].rows).toHaveLength(205)
  expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('000204</t>')

  mockPage(page(table(), 'new byte layout only'), '2026-10-13T12:00:00.000Z')
  const refresh = service.run(project.id, workflow.id, false)
  await terminal(service, refresh.id)
  expect(acquire).toHaveBeenCalledTimes(2)
  expect(service.detail(project.id, refresh.id).changes).toEqual({
    added: 0,
    changed: 0,
    removed: 0,
  })
  expect(service.store.inputs(refresh.id)[0].sourceVersion).not.toBe(discovery.sourceVersion)
  await service.publish(project.id, refresh.id, true, false)

  mockPage(page(table(204, 'Revised source value')), '2026-10-14T12:00:00.000Z')
  const changed = service.run(project.id, workflow.id, false)
  await terminal(service, changed.id)
  expect(acquire).toHaveBeenCalledTimes(3)
  expect(service.detail(project.id, changed.id).changes).toEqual({
    added: 0,
    changed: 1,
    removed: 1,
  })
  await service.publish(project.id, changed.id, true, false)
  expect(service.store.accepted(workflow.id)!.tables[0].rows).toHaveLength(205)
  const accepted = service.store.accepted(workflow.id)!.tables[0].rows
  expect(accepted.find((row) => row.cells.column_1.value === '000153')!.cells.column_2.value).toBe(
    'Revised source value',
  )
  expect(accepted.find((row) => row.cells.column_1.value === '000204')!.cells.column_2.value).toBe(
    'Item 204',
  )
})

it('keeps exact notes, header confirmations and key-column protection scoped to each selected table', async () => {
  const { project, service } = await fixture()
  mockPage(
    page(
      '<h2>2026 public holidays</h2><table><tr><td>Holiday</td><td>Date</td></tr><tr><td>Boxing Day</td><td>26th December</td></tr></table><p>Observed-day exception: Monday, 28th December.</p>' +
        '<h2>Departments</h2><table><tr><th>Label</th><th>ID</th></tr><tr><td>Office</td><td>D1</td></tr></table>',
    ),
  )
  const discovery = await service.discoverTables(project.id, {
    url: 'https://example.test/catalogue',
  })
  expect(discovery.tables[0].notes).toContainEqual(
    expect.objectContaining({ text: 'Observed-day exception: Monday, 28th December.' }),
  )
  const selected = config(discovery)
  expect(() => service.save(project.id, 'Unconfirmed', selected)).toThrow('Confirm')
  selected.htmlTables!.selections[0].confirmFirstRowAsHeader = true
  selected.htmlTables!.selections[1].keyColumns = ['column_2']
  const workflow = service.save(project.id, 'Confirmed tables', selected),
    run = service.run(project.id, workflow.id, false)
  await terminal(service, run.id)
  await service.publish(project.id, run.id, true, false)
  const accepted = service.store.accepted(workflow.id)!,
    holiday = accepted.tables[0],
    department = accepted.tables[1]
  expect(accepted.issues.join(' ')).toContain('Observed-day exception: Monday, 28th December.')
  await expect(
    service.correct(
      project.id,
      workflow.id,
      holiday.id,
      holiday.rows[0].id,
      'column_1',
      'A different holiday',
      'Review',
    ),
  ).rejects.toThrow('key columns')
  await expect(
    service.correct(
      project.id,
      workflow.id,
      department.id,
      department.rows[0].id,
      'column_2',
      'D2',
      'Review',
    ),
  ).rejects.toThrow('key columns')
  await service.correct(
    project.id,
    workflow.id,
    department.id,
    department.rows[0].id,
    'column_1',
    'Office — reviewed',
    'Personal interpretation retained as manual',
  )
  mockPage(
    page(
      '<h2>2026 public holidays</h2><table><tr><td>Holiday</td><td>Date</td></tr><tr><td>Boxing Day</td><td>26th December</td></tr></table><p>Observed-day exception: Monday, 28th December.</p>' +
        '<h2>Departments</h2><table><tr><th>Label</th><th>ID</th></tr><tr><td>Office renamed at source</td><td>D1</td></tr></table>',
    ),
  )
  const refresh = service.run(project.id, workflow.id, false)
  await terminal(service, refresh.id)
  expect(service.store.run(refresh.id).candidate!.tables[1].rows[0].cells.column_1).toMatchObject({
    value: 'Office — reviewed',
    origin: 'manual',
  })
  await service.publish(project.id, refresh.id, true, false)
  expect(service.store.accepted(workflow.id)!.issues.join(' ')).toContain('28th December')
  const scoped = structuredClone(selected)
  scoped.htmlTables!.selections = [scoped.htmlTables!.selections[1]]
  service.save(project.id, 'Departments only', scoped, workflow.id)
  const narrowed = service.run(project.id, workflow.id, false)
  await terminal(service, narrowed.id)
  await service.publish(project.id, narrowed.id, true, false)
  expect(service.store.accepted(workflow.id)!.tables.some((table) => table.id === holiday.id)).toBe(
    true,
  )
  await expect(
    service.correct(
      project.id,
      workflow.id,
      holiday.id,
      holiday.rows[0].id,
      'column_1',
      'A changed retained key',
      'Review',
    ),
  ).rejects.toThrow('key columns')
})

it('checks project ownership and local hashes, sees updated HTML snapshots, and preserves older proof bytes', async () => {
  const { root, workspace, project, service } = await fixture(),
    original = join(root, 'catalogue.html')
  writeFileSync(original, page(table(3)))
  const added = await workspace.addSource(project.id, { path: original }),
    source = added.workspace!.sources[0],
    other = await workspace.create({ name: 'Other project', description: 'Ownership test' })
  await expect(service.discoverTables(other.id, { sourceId: source.id })).rejects.toThrow(
    'belonging to this project',
  )
  await expect(
    service.discoverTables(project.id, {
      url: 'https://example.test/catalogue',
      sourceId: source.id,
    }),
  ).rejects.toThrow('exactly one')
  const discovery = await service.discoverTables(project.id, { sourceId: source.id }),
    workflow = service.save(project.id, 'Local HTML', config(discovery, { sourceId: source.id })),
    first = service.run(project.id, workflow.id, false)
  await terminal(service, first.id)
  await service.publish(project.id, first.id, true, false)
  const proof = service.store.accepted(workflow.id)!.tables[0].rows[0].cells.column_2.evidence[0]
  writeFileSync(original, page(table(4)))
  await workspace.updateSource(project.id, source.id, original)
  expect(service.detail(project.id, first.id).inputsChanged).toBe(true)
  await expect(service.evidence(project.id, proof)).resolves.toMatchObject({ text: 'Item 0' })
  const refreshed = service.run(project.id, workflow.id, false)
  await terminal(service, refreshed.id)
  expect(service.detail(project.id, refreshed.id).changes).toEqual({
    added: 1,
    changed: 0,
    removed: 0,
  })
  expect(acquire).not.toHaveBeenCalled()
  await service.publish(project.id, refreshed.id, true, false)
  const current = workspace.get(project.id).workspace.sources[0]
  writeFileSync(current.snapshotPath!, page(table(5)))
  await expect(service.discoverTables(project.id, { sourceId: source.id })).rejects.toThrow(
    'integrity',
  )
  const failed = service.run(project.id, workflow.id, false)
  expect((await terminal(service, failed.id, 'failed')).coverage.failed).toBe(1)
  expect(service.store.accepted(workflow.id)!.tables[0].rows).toHaveLength(4)
})

it('rejects foreign preview tokens, re-captures expired previews, and fences accepted source/key identity changes', async () => {
  const { workspace, project, service } = await fixture()
  mockPage(page(table(3)))
  const discovery = await service.discoverTables(project.id, {
      url: 'https://example.test/catalogue',
    }),
    other = await workspace.create({ name: 'Other project', description: 'Preview ownership' })
  expect(() => service.save(other.id, 'Foreign capture', config(discovery))).toThrow(
    'another project',
  )
  const workflow = service.save(project.id, 'Expired capture', config(discovery)),
    time = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(time + 16 * 60_000)
  const run = service.run(project.id, workflow.id, false)
  await terminal(service, run.id)
  clock.mockRestore()
  expect(acquire).toHaveBeenCalledTimes(2)
  await service.publish(project.id, run.id, true, false)
  const changedKey = config(discovery)
  changedKey.htmlTables!.selections[0].keyColumns = ['column_2']
  expect(() => service.save(project.id, 'Changed key', changedKey, workflow.id)).toThrow(
    'row identity',
  )
  const changedSource = config(discovery, { url: 'https://example.test/other' })
  expect(() => service.save(project.id, 'Changed source', changedSource, workflow.id)).toThrow(
    'row identity',
  )
})

it('cancels with a pinned input, retries that same capture, and leaves accepted data untouched until review publication', async () => {
  const { workspace, project, service } = await fixture(),
    bytes = page(table(3))
  mockPage(bytes)
  const discovery = await service.discoverTables(project.id, {
      url: 'https://example.test/catalogue',
    }),
    workflow = service.save(project.id, 'Cancelled capture', config(discovery))
  let release!: (bytes: Buffer) => void
  const originalRead = workspace.boundedRead.bind(workspace),
    read = vi.spyOn(workspace, 'boundedRead').mockImplementationOnce(
      () =>
        new Promise<Buffer>((resolve) => {
          release = resolve
        }),
    )
  const run = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  service.cancel(project.id, run.id)
  release(bytes)
  await terminal(service, run.id, 'cancelled')
  expect(service.store.inputs(run.id)).toHaveLength(1)
  expect(service.store.accepted(workflow.id)).toBeNull()
  read.mockImplementation(originalRead)
  mockPage(page(table(4)))
  const retried = service.retry(project.id, run.id)
  expect((await terminal(service, retried.id)).candidate!.tables[0].rows).toHaveLength(3)
  expect(acquire).toHaveBeenCalledTimes(1)
  await service.publish(project.id, retried.id, true, false)
  expect(service.store.accepted(workflow.id)!.tables[0].rows).toHaveLength(3)
})

it('fails closed when a refresh is partial or table schema changes, and retries durable failures without substituting new source bytes', async () => {
  const { project, service } = await fixture()
  mockPage(page(table(3)))
  const discovery = await service.discoverTables(project.id, {
      url: 'https://example.test/catalogue',
    }),
    workflow = service.save(project.id, 'Guarded refresh', config(discovery)),
    first = service.run(project.id, workflow.id, false)
  await terminal(service, first.id)
  await service.publish(project.id, first.id, true, false)
  mockPage(page(table(3) + '<a rel="next" href="?page=2">Next</a>'))
  const partial = service.run(project.id, workflow.id, false)
  expect((await terminal(service, partial.id, 'failed')).error).toContain('coverage')
  expect(service.store.accepted(workflow.id)!.tables[0].rows).toHaveLength(3)
  mockPage(page(table(4)))
  service.retry(project.id, partial.id)
  await terminal(service, partial.id, 'failed')
  expect(acquire).toHaveBeenCalledTimes(2)
  mockPage(page(table(4, '', '<th>New ID</th><th>Value</th>')))
  const schemaChanged = service.run(project.id, workflow.id, false)
  expect((await terminal(service, schemaChanged.id, 'failed')).error).toContain('no longer matches')
  expect(service.store.accepted(workflow.id)!.tables[0].rows).toHaveLength(3)
})

it('reports note-only content changes separately from row facts and ignores locator movement', async () => {
  const { project, service } = await fixture()
  const note = '<p>Observed-day exception: Monday, 28th December.</p>'
  mockPage(page(table(3) + note))
  const discovery = await service.discoverTables(project.id, {
      url: 'https://example.test/catalogue',
    }),
    workflow = service.save(project.id, 'Source context', config(discovery)),
    first = service.run(project.id, workflow.id, false)
  await terminal(service, first.id)
  expect(service.detail(project.id, first.id).htmlContextChanged).toBe(false)
  await service.publish(project.id, first.id, true, false)
  mockPage(page('<div>' + table(3) + note + '</div>'))
  const relocated = service.run(project.id, workflow.id, false)
  await terminal(service, relocated.id)
  expect(service.detail(project.id, relocated.id)).toMatchObject({
    changes: { added: 0, changed: 0, removed: 0 },
    htmlContextChanged: false,
  })
  await service.publish(project.id, relocated.id, true, false)
  mockPage(page(table(3) + '<p>Observed-day exception: Tuesday, 29th December.</p>'))
  const noteChanged = service.run(project.id, workflow.id, false)
  await terminal(service, noteChanged.id)
  expect(service.detail(project.id, noteChanged.id)).toMatchObject({
    changes: { added: 0, changed: 0, removed: 0 },
    htmlContextChanged: true,
  })
  expect(service.store.accepted(workflow.id)!.issues.join(' ')).toContain('28th December')
})

it('maps readable and machine-like headers to canonical IDs, keeps reordered row proof stable and reads legacy ID headers', async () => {
  const { root, project, workspace, service } = await fixture()
  mockPage(
    page(
      '<h2>Readable identity</h2><table><tr><th>column_2</th><th>column_1</th><th>Published amount ($) / value</th></tr>' +
        '<tr><td>ROW-A</td><td>Source A</td><td>001.25</td></tr>' +
        '<tr><td>ROW-B</td><td>Source B</td><td>002.50</td></tr></table>',
    ),
  )
  const discovery = await service.discoverTables(project.id, {
      url: 'https://example.test/catalogue',
    }),
    workflow = service.save(project.id, 'Readable identity', config(discovery)),
    run = service.run(project.id, workflow.id, false)
  await terminal(service, run.id)
  const workbook = await service.publish(project.id, run.id, true, false),
    accepted = service.store.accepted(workflow.id)!.tables[0],
    first = accepted.rows[0],
    second = accepted.rows[1],
    zip = await JSZip.loadAsync(readFileSync(workbook)),
    metadata = JSON.parse(await zip.file('infomonk/research.json')!.async('string'))
  expect(metadata.tables[0].headerMode).toBe('labels')
  // These labels intentionally collide with the other column's machine ID.
  await expect(
    service.sheetCell(workbook, {
      tableId: accepted.name,
      rowId: first.id,
      columnId: 'column_2',
      value: 'ROW-A',
    }),
  ).resolves.toMatchObject({
    tableId: accepted.id,
    columnId: 'column_1',
    cell: { value: 'ROW-A' },
    editedInSheet: false,
  })
  await expect(
    service.sheetCell(workbook, {
      tableId: accepted.name,
      rowId: first.id,
      columnId: 'column_1',
      value: 'Source A',
    }),
  ).resolves.toMatchObject({
    columnId: 'column_2',
    cell: { value: 'Source A' },
    editedInSheet: false,
  })
  await expect(
    service.sheetCell(workbook, {
      tableId: accepted.name,
      rowId: first.id,
      columnId: 'Published amount ($) / value',
      value: '001.25',
    }),
  ).resolves.toMatchObject({
    columnId: 'column_3',
    columnName: 'Published amount ($) / value',
    cell: { value: '001.25' },
  })
  await expect(
    service.sheetCell(workbook, {
      tableId: accepted.id,
      rowId: first.id,
      columnId: 'column_2',
      value: 'Source A',
    }),
  ).resolves.toMatchObject({ columnId: 'column_2', cell: { value: 'Source A' } })
  await expect(
    service.sheetCell(workbook, {
      tableId: accepted.name,
      rowId: first.id,
      columnId: 'column_3',
      value: '001.25',
    }),
  ).resolves.toBeNull()

  const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string'),
    row2 = sheet.match(/<row\b[^>]*r="2"[^>]*>[\s\S]*?<\/row>/)![0],
    row3 = sheet.match(/<row\b[^>]*r="3"[^>]*>[\s\S]*?<\/row>/)![0]
  const renumber = (row: string, old: number, next: number) =>
    row
      .replace(`r="${old}"`, `r="${next}"`)
      .replace(new RegExp(`r="([A-Z]+)${old}"`, 'g'), `r="$1${next}"`)
  const reordered = sheet
    .replace(row2, '__FIRST_ROW__')
    .replace(row3, renumber(row2, 2, 3))
    .replace('__FIRST_ROW__', renumber(row3, 3, 2))
  zip.file('xl/worksheets/sheet1.xml', reordered)
  const reorderedPath = join(root, 'Reordered.xlsx')
  writeFileSync(reorderedPath, await zip.generateAsync({ type: 'nodebuffer' }))
  workspace.projects.moveFileToProject(reorderedPath, project.id)
  const hiddenId = reordered.match(/<c\b[^>]*r="D2"[^>]*>[\s\S]*?<t[^>]*>([a-f0-9]{24})<\/t>/)![1]
  expect(hiddenId).toBe(second.id)
  const reorderedProof = await service.sheetCell(reorderedPath, {
    tableId: accepted.name,
    rowId: hiddenId,
    columnId: 'column_1',
    value: 'Source B',
  })
  expect(reorderedProof).toMatchObject({
    rowId: second.id,
    columnId: 'column_2',
    editedInSheet: false,
    cell: { value: 'Source B' },
  })
  expect(reorderedProof!.cell.evidence[0].excerpt).toBe('Source B')
  // A value moved without its helper ID stays a sheet edit, rather than acquiring another row's proof.
  await expect(
    service.sheetCell(reorderedPath, {
      tableId: accepted.name,
      rowId: first.id,
      columnId: 'column_1',
      value: 'Source B',
    }),
  ).resolves.toMatchObject({ editedInSheet: true, cell: { value: 'Source A' } })

  const legacy = await JSZip.loadAsync(readFileSync(workbook))
  delete metadata.tables[0].headerMode
  delete metadata.tables[0].columns
  legacy.file('infomonk/research.json', JSON.stringify(metadata))
  let legacySheet = sheet
  for (const [address, id] of [
    ['A1', 'column_1'],
    ['B1', 'column_2'],
    ['C1', 'column_3'],
  ])
    legacySheet = legacySheet.replace(
      new RegExp(`(<c r="${address}"[^>]*>[\\s\\S]*?<t[^>]*>)[\\s\\S]*?(</t>)`),
      `$1${id}$2`,
    )
  legacy.file('xl/worksheets/sheet1.xml', legacySheet)
  const legacyPath = join(root, 'Legacy-ID-Headers.xlsx')
  writeFileSync(legacyPath, await legacy.generateAsync({ type: 'nodebuffer' }))
  workspace.projects.moveFileToProject(legacyPath, project.id)
  await expect(
    service.sheetCell(legacyPath, {
      tableId: accepted.name,
      rowId: first.id,
      columnId: 'column_1',
      value: 'ROW-A',
    }),
  ).resolves.toMatchObject({
    tableId: accepted.id,
    columnId: 'column_1',
    editedInSheet: false,
    cell: { value: 'ROW-A' },
  })
})
