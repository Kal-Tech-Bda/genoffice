import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import JSZip from 'jszip'
import { ResearchStore, diffDataset } from '../src/main/research/store'
import {
  cell,
  extractQuote,
  hash,
  mergeDatasets,
  parseSource,
  quoteColumns,
} from '../src/main/research/extract'
import { fetchPopulation, parsePopulation, worldBankUrl } from '../src/main/research/worldbank'
import { projectDataset } from '../src/main/research/projection'
import { WorkspaceStore } from '../src/main/workspace-store'
import { ResearchService } from '../src/main/research/service'
import type { ResearchConfig, ResearchDataset } from '../src/shared/research-api'

const source = {
  sourceId: 'demo',
  sourceVersion: hash('demo'),
  sourceName: 'demo.txt',
  uri: 'fixture:demo',
  retrievedAt: '2026-10-10T00:00:00Z',
}
const config: ResearchConfig = {
  kind: 'quotes',
  instructions: 'Bounded supplier quotes',
  sourceIds: [],
  fields: quoteColumns.map((c) => c.id),
  countries: ['CAN', 'USA'],
  fromYear: 2023,
  toYear: 2024,
}
const fixture = (name: string) => readFileSync(resolve('../../fixtures/infomonk/research', name))
const stores: ResearchStore[] = []
const open = (path?: string) => {
  const store = new ResearchStore(
    path ?? join(mkdtempSync(join(tmpdir(), 'infomonk-research-')), 'data.sqlite'),
  )
  stores.push(store)
  return store
}
const dataset = async () =>
  extractQuote(await parseSource(fixture('valid.txt'), 'valid.txt'), source, config.fields)
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('document extraction and evidence', () => {
  it('extracts simple DOCX label/value and item tables with exact cell locators', async () => {
    const data = extractQuote(
      await parseSource(fixture('table.docx'), 'table.docx'),
      source,
      config.fields,
    )
    expect(data.tables[0].rows[0].cells.total.value).toBe(125.5)
    expect(data.tables[0].rows[0].cells.total.evidence[0].locator).toBe(
      'DOCX body element 2, table row 5, cell 2',
    )
    expect(data.tables[1].rows[0].cells.quantity.value).toBe(5)
    expect(data.tables[1].rows[0].cells.quantity.evidence[0].locator).toBe(
      'DOCX body element 3, table row 2, cell 3',
    )
  })
  it('extracts inherited DOCX and text consistently with exact block/line locators and related items', async () => {
    const text = await dataset()
    const doc = extractQuote(
      await parseSource(fixture('valid.docx'), 'valid.docx'),
      source,
      config.fields,
    )
    expect(text.tables[0].rows[0].cells.total.value).toBe(125.5)
    expect(doc.tables[0].rows[0].cells.total.value).toBe(125.5)
    expect(doc.tables[0].rows[0].cells.total.evidence[0].locator).toBe('DOCX body element 6')
    expect(text.tables[1].rows).toHaveLength(2)
    expect(doc.tables[0].rows[0].id).toBe(text.tables[0].rows[0].id)
  })
  it('leaves missing/invalid/conflicting facts missing, and rejects unsupported families', async () => {
    const missing = extractQuote(
      await parseSource(fixture('missing.md'), 'missing.md'),
      source,
      config.fields,
    )
    expect(missing.tables[0].rows[0].cells.total.value).toBeNull()
    expect(missing.tables[0].rows[0].cells.total.evidence).toEqual([])
    expect(missing.tables[0].rows[0].cells.date.issues).toHaveLength(1)
    const conflict = extractQuote(
      await parseSource(fixture('conflict.txt'), 'conflict.txt'),
      source,
      config.fields,
    )
    expect(conflict.tables[0].rows[0].cells.total.value).toBeNull()
    expect(conflict.tables[0].rows[0].cells.total.evidence).toHaveLength(2)
    expect(() =>
      extractQuote(
        { units: [{ locator: 'Text line 1', text: 'Unknown prose' }], method: 'test' },
        source,
        config.fields,
      ),
    ).toThrow('Unsupported document family')
  })
  it('deduplicates immutable/business keys and flags inconsistent copies', async () => {
    const first = await dataset()
    expect(mergeDatasets([first, first]).tables[0].rows).toHaveLength(1)
    const changed = structuredClone(first)
    changed.tables[0].rows[0].cells.total.value = 140
    expect(mergeDatasets([first, changed]).tables[0].rows[0].cells.total.missingReason).toContain(
      'conflicting',
    )
  })
  it('projects separate worksheets with IDs and linked metadata', async () => {
    const zip = await JSZip.loadAsync(await projectDataset(await dataset(), 'demo', 1))
    expect(await zip.file('xl/workbook.xml')!.async('string')).toContain('Line items')
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain(
      '_infomonk_record_id',
    )
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('hidden="1"')
    expect(JSON.parse(await zip.file('infomonk/research.json')!.async('string')).revision).toBe(1)
  })
  it('keeps scientific-looking hexadecimal IDs and numeric-looking text as literal strings', async () => {
    const d = await dataset()
    d.tables[0].rows[0].id = '0e1234567890123456789012'
    d.tables[0].rows[0].cells.quote_id.value = '12345'
    const zip = await JSZip.loadAsync(await projectDataset(d, 'demo', 1))
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(xml).toContain(
      '<c r="G2" t="inlineStr"><is><t xml:space="preserve">0e1234567890123456789012</t>',
    )
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">12345</t>')
  })
})
describe('transactional accepted ledger and workflow fences', () => {
  it('rolls back revisions and normalized cells together if publication fails inside SQLite', async () => {
    const store = open()
    const w = store.save('project', 'Quotes', config)
    const run = store.queue(w.id, false)
    store.review(run.id, await dataset(), { complete: 1, failed: 0, total: 1 })
    store.db.exec(
      "CREATE TRIGGER fixture_abort BEFORE INSERT ON accepted_cells BEGIN SELECT RAISE(ABORT,'fixture failure'); END;",
    )
    expect(() => store.publish(run.id, store.prepare(run.id, true, false), 'orphan.xlsx')).toThrow(
      'fixture failure',
    )
    expect(store.workflow(w.id).acceptedRevision).toBe(0)
    expect(store.accepted(w.id)).toBeNull()
    expect(store.db.prepare('SELECT count(*) AS n FROM revisions').get()?.n).toBe(0)
    expect(store.run(run.id).status).toBe('review')
  })
  async function ready(store: ResearchStore, w: string, d?: ResearchDataset) {
    const run = store.queue(w, false)
    store.review(run.id, d ?? (await dataset()), { complete: 1, failed: 0, total: 1 })
    return run
  }
  it('keeps accepted data across restart, with normalized cells and schema migration', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'infomonk-ledger-')), 'data.sqlite')
    const store = open(path)
    const w = store.save('project', 'Quotes', config)
    const r = await ready(store, w.id)
    store.publish(r.id, store.prepare(r.id, true, false), 'r1.xlsx')
    expect(store.db.prepare('SELECT count(*) AS n FROM accepted_cells').get()?.n).toBe(14)
    store.close()
    stores.splice(stores.indexOf(store), 1)
    const restarted = open(path)
    expect(restarted.accepted(w.id)?.tables[0].rows[0].cells.total.value).toBe(125.5)
    expect(restarted.workflow(w.id).acceptedRevision).toBe(1)
  })
  it('blocks samples, incomplete coverage and unreviewed missing facts', async () => {
    const store = open()
    const w = store.save('project', 'Quotes', config)
    const sample = store.queue(w.id, true)
    store.review(sample.id, await dataset(), { complete: 1, failed: 0, total: 2 })
    expect(() => store.prepare(sample.id, true, false)).toThrow('Samples')
    store.cancel(sample.id)
    const full = store.queue(w.id, false)
    store.review(full.id, await dataset(), { complete: 1, failed: 1, total: 2 })
    expect(() => store.prepare(full.id, true, false)).toThrow('Incomplete')
    expect(store.accepted(w.id)).toBeNull()
    store.cancel(full.id)
    const empty = store.queue(w.id, false)
    store.review(
      empty.id,
      { schemaVersion: 1, tables: [], issues: [] },
      { complete: 0, failed: 0, total: 0 },
    )
    expect(() => store.prepare(empty.id, true, false)).toThrow('Incomplete')
    store.cancel(empty.id)
    const missing = await dataset()
    missing.tables[0].rows[0].cells.total = cell(null)
    const r = await ready(store, w.id, missing)
    expect(() => store.prepare(r.id, false, false)).toThrow('Acknowledge')
  })
  it('fences cancellation and edited configuration before publication', async () => {
    const store = open()
    const w = store.save('project', 'Quotes', config)
    const r = await ready(store, w.id)
    const prepared = store.prepare(r.id, true, false)
    store.cancel(r.id)
    expect(() => store.publish(r.id, prepared, 'cancel.xlsx')).toThrow('cancelled')
    const r2 = await ready(store, w.id)
    store.save('project', 'Edited', config, w.id)
    expect(store.run(r2.id).status).toBe('obsolete')
    expect(() => store.publish(r2.id, prepared, 'old.xlsx')).toThrow('obsolete')
    expect(store.accepted(w.id)).toBeNull()
  })
  it('preserves human corrections on idempotent reruns and prevents stale candidates replacing them', async () => {
    const store = open()
    const w = store.save('project', 'Quotes', config)
    const r = await ready(store, w.id)
    const original = store.prepare(r.id, true, false)
    store.publish(r.id, original, 'r1.xlsx')
    const next = await ready(store, w.id)
    const corrected = structuredClone(original)
    const row = corrected.tables[0].rows[0]
    row.cells.total = { ...row.cells.total, value: 130, origin: 'manual' }
    store.correct(w.id, 'quotes', row.id, 'total', 130, 'Reviewed invoice', corrected, 'r2.xlsx', 1)
    expect(() => store.prepare(next.id, true, false)).toThrow('changed accepted revision')
    store.cancel(next.id)
    const fresh = await ready(store, w.id)
    const prepared = store.prepare(fresh.id, true, false)
    expect(prepared.tables[0].rows[0].cells.total.value).toBe(130)
    expect(store.run(fresh.id).changes).toEqual({ added: 0, changed: 0, removed: 0 })
    store.publish(fresh.id, prepared, 'r3.xlsx')
    expect(store.corrections(w.id)).toHaveLength(1)
  })
  it('retains absent records until reviewed and always retains overridden rows', async () => {
    const store = open()
    const w = store.save('project', 'Quotes', config)
    const r = await ready(store, w.id)
    store.publish(r.id, store.prepare(r.id, true, false), 'r1.xlsx')
    const empty: ResearchDataset = { schemaVersion: 1, tables: [], issues: [] }
    const r2 = await ready(store, w.id, empty)
    expect(store.prepare(r2.id, true, false).tables[0].rows).toHaveLength(1)
    expect(store.prepare(r2.id, true, true).tables).toHaveLength(0)
  })
  it('persists inputs before the cursor and recovers interrupted processing for explicit retry', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'infomonk-crash-')), 'data.sqlite')
    const store = open(path)
    const w = store.save('project', 'Quotes', config)
    const r = store.queue(w.id, false)
    store.progress(r.id, 'processing', 'Working')
    store.input(
      r.id,
      {
        ordinal: 0,
        sourceId: 's',
        sourceVersion: hash('x'),
        name: 'x',
        uri: 'fixture:x',
        retrievedAt: 'now',
        path: 'x',
        parsed: null,
        error: null,
      },
      { page: 1 },
    )
    store.close()
    stores.splice(stores.indexOf(store), 1)
    const recovered = open(path)
    expect(recovered.run(r.id).status).toBe('failed')
    expect(recovered.inputs(r.id)).toHaveLength(1)
    expect(recovered.retry(r.id).status).toBe('queued')
    expect(() => recovered.queue(w.id, false)).toThrow('current run')
  })
  it('persists app-open schedules and independent accepted/config/execution versions', () => {
    const store = open()
    const w = store.save('project', 'Quotes', config)
    store.schedule(w.id, 15, false)
    expect(store.workflow(w.id).nextAt).not.toBeNull()
    store.db.prepare('UPDATE workflows SET next_at=? WHERE id=?').run('2000-01-01T00:00:00Z', w.id)
    expect(store.due()).toHaveLength(1)
    store.schedule(w.id, 15, true)
    expect(store.due()).toHaveLength(0)
    expect(store.workflow(w.id).acceptedRevision).toBe(0)
  })
  it('reports added, changed and removed row keys without duplicating reruns', async () => {
    const d = await dataset()
    expect(diffDataset(d, structuredClone(d))).toEqual({ added: 0, changed: 0, removed: 0 })
    const changed = structuredClone(d)
    changed.tables[0].rows[0].cells.total.value = 140
    expect(diffDataset(d, changed).changed).toBe(1)
    expect(diffDataset(d, { schemaVersion: 1, tables: [], issues: [] }).removed).toBe(3)
  })
})
describe('bounded structured web acquisition', () => {
  it('bounds a web sample to one page and retries failed pagination from durable acquired bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'infomonk-paging-'))
    const workspace = new WorkspaceStore(dir)
    const p = await workspace.create({ name: 'Population', description: '' })
    const service = new ResearchService(dir, workspace)
    stores.push(service.store)
    const c: ResearchConfig = {
      ...config,
      kind: 'worldbank',
      countries: ['CAN', 'USA', 'MEX', 'FRA'],
      fromYear: 2022,
      toYear: 2024,
    }
    const records = c.countries.flatMap((country) =>
      [2022, 2023, 2024].map((year) => ({
        indicator: { id: 'SP.POP.TOTL', value: 'Population, total' },
        country: { id: country, value: country },
        countryiso3code: country,
        date: String(year),
        value: 100 + year,
        unit: '',
        obs_status: '',
        decimal: 0,
      })),
    )
    const response = (page: number) =>
      Buffer.from(
        JSON.stringify([
          { page, pages: 2, per_page: 10, total: 12 },
          records.slice((page - 1) * 10, page * 10),
        ]),
      )
    const fetch = vi.fn().mockResolvedValue(new Response(response(1)))
    vi.stubGlobal('fetch', fetch)
    const w = service.save(p.id, 'Population', c)
    const sample = service.run(p.id, w.id, true)
    await vi.waitFor(() => expect(service.store.run(sample.id).status).toBe('review'))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(service.store.run(sample.id).coverage).toEqual({ complete: 1, failed: 0, total: 2 })
    service.cancel(p.id, sample.id)
    const broken = vi
      .fn()
      .mockResolvedValueOnce(new Response(response(1)))
      .mockResolvedValueOnce(new Response('Denied', { status: 403 }))
    vi.stubGlobal('fetch', broken)
    const full = service.run(p.id, w.id, false)
    await vi.waitFor(() => expect(service.store.run(full.id).status).toBe('failed'))
    expect(service.store.inputs(full.id)).toHaveLength(1)
    expect(service.store.run(full.id).coverage).toEqual({ complete: 1, failed: 1, total: 2 })
    const resumed = vi.fn().mockResolvedValue(new Response(response(2)))
    vi.stubGlobal('fetch', resumed)
    service.retry(p.id, full.id)
    await vi.waitFor(() => expect(service.store.run(full.id).status).toBe('review'))
    expect(resumed).toHaveBeenCalledTimes(1)
    expect(resumed.mock.calls[0][0]).toContain('page=2')
    expect(service.store.run(full.id).candidate!.tables[0].rows).toHaveLength(12)
    expect(service.store.run(full.id).events.filter((e) => e.status === 'queued')).toHaveLength(2)
    const reference = service.store.run(full.id).candidate!.tables[0].rows[0].cells.population
      .evidence[0]
    expect((await service.evidence(p.id, reference)).text).toContain('obs_status')
    service.close()
  })
  const web = { ...config, kind: 'worldbank' as const }
  const raw = (page = 1) =>
    Buffer.from(
      JSON.stringify([
        { page, pages: 1, per_page: 10, total: 1 },
        [
          {
            indicator: { id: 'SP.POP.TOTL' },
            country: { value: 'Canada' },
            countryiso3code: 'CAN',
            date: '2024',
            value: 123,
          },
        ],
      ]),
    )
  it('validates scope, indicator, pagination, missing values and exact JSON pointers', () => {
    const parsed = parsePopulation(raw(), source, web, 1)
    expect(parsed.dataset.tables[0].rows[0].cells.population.value).toBe(123)
    expect(parsed.dataset.tables[0].rows[0].cells.population.evidence[0].locator).toBe(
      'JSON /1/0/value',
    )
    expect(worldBankUrl(web, 1)).toContain('country/CAN;USA')
    expect(() => parsePopulation(raw(), source, { ...web, countries: ['USA'] }, 1)).toThrow('scope')
    expect(() => parsePopulation(raw(2), source, web, 1)).toThrow('scope')
    const missing = JSON.parse(raw().toString())
    missing[1][0].value = null
    expect(
      parsePopulation(Buffer.from(JSON.stringify(missing)), source, web, 1).dataset.tables[0]
        .rows[0].cells.population.missingReason,
    ).toContain('no observation')
  })
  it('retries rate limits and fails HTTP errors without claiming extraction success', async () => {
    vi.useFakeTimers()
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('limit', { status: 429, headers: { 'retry-after': '1' } }),
      )
      .mockResolvedValueOnce(new Response(raw()))
    vi.stubGlobal('fetch', request)
    const result = fetchPopulation(worldBankUrl(web, 1), new AbortController().signal)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toEqual(raw())
    expect(request).toHaveBeenCalledTimes(2)
    const longWait = vi
      .fn()
      .mockResolvedValue(new Response('Wait', { status: 429, headers: { 'retry-after': '600' } }))
    vi.stubGlobal('fetch', longWait)
    await expect(
      fetchPopulation(worldBankUrl(web, 1), new AbortController().signal),
    ).rejects.toThrow('longer wait')
    expect(longWait).toHaveBeenCalledTimes(1)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })))
    await expect(
      fetchPopulation(worldBankUrl(web, 1), new AbortController().signal),
    ).rejects.toThrow('HTTP 403')
    await expect(
      fetchPopulation('https://example.com', new AbortController().signal),
    ).rejects.toThrow('Unsupported')
  })
  it('runs a partial failed document batch without publishing and verifies snapshot integrity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'infomonk-service-'))
    const workspace = new WorkspaceStore(dir)
    const project = await workspace.create({
      name: 'Quotes',
      description: '',
      filePath: resolve('../../fixtures/infomonk/research/valid.txt'),
    })
    await workspace.addSource(project.id, {
      path: resolve('../../fixtures/infomonk/research/unsupported.txt'),
    })
    const service = new ResearchService(dir, workspace)
    stores.push(service.store)
    const w = service.save(project.id, 'Quotes', {
      ...config,
      sourceIds: workspace.get(project.id).workspace.sources.map((s) => s.id),
    })
    const r = service.run(project.id, w.id, false)
    await vi.waitFor(() => expect(service.store.run(r.id).status).toBe('review'))
    const current = service.store.run(r.id)
    expect(current.coverage).toEqual({ complete: 1, failed: 1, total: 2 })
    await expect(service.publish(project.id, r.id, true, false)).rejects.toThrow('Incomplete')
    const e = current.candidate!.tables[0].rows[0].cells.total.evidence[0]
    expect((await service.evidence(project.id, e)).locator).toBe('Text line 6')
    service.close()
  })
})
