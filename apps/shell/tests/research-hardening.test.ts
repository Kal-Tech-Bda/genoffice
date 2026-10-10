import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { WorkspaceStore } from '../src/main/workspace-store'
import { ResearchService } from '../src/main/research/service'
import { datasetPage } from '../src/main/research/pages'
import { RESEARCH_METADATA_LIMIT } from '../src/main/research/metadata'
import { projectDataset } from '../src/main/research/projection'
import {
  assertEngineeringCapability,
  ENGINEERING_POLICY,
} from '../src/main/research/engineering-policy'
import { cell, hash, quoteColumns } from '../src/main/research/extract'
import type { ResearchConfig, ResearchDataset } from '../src/shared/research-api'

const config: ResearchConfig = {
  kind: 'quotes',
  instructions: 'Extract labeled quotes',
  sourceIds: [],
  fields: quoteColumns.map((c) => c.id),
  countries: ['CAN'],
  fromYear: 2023,
  toYear: 2024,
}
const services: ResearchService[] = []
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-hardening-'))
  const workspace = new WorkspaceStore(root)
  const project = await workspace.create({ name: 'Synthetic', description: '' })
  const service = new ResearchService(root, workspace)
  services.push(service)
  const workflow = service.store.save(project.id, 'Quotes', config)
  return { root, workspace, project, service, workflow }
}
function rows(count: number): ResearchDataset {
  return {
    schemaVersion: 1,
    issues: [],
    tables: [
      {
        id: 'quotes',
        name: 'Quotes',
        rowMeaning: 'One synthetic quote',
        columns: [{ id: 'total', name: 'Total', type: 'number' }],
        rows: Array.from({ length: count }, (_, i) => ({
          id: hash(String(i)).slice(0, 24),
          cells: {
            total: cell(i, [
              {
                sourceId: 'fixture',
                sourceVersion: hash('fixture'),
                sourceName: 'fixture.txt',
                uri: 'fixture:synthetic',
                retrievedAt: '2026-10-10T00:00:00Z',
                locator: `Text line ${i + 1}`,
                excerpt: `Total: ${i}`,
                method: 'fixture',
              },
            ]),
          },
        })),
      },
    ],
  }
}
afterEach(() => {
  for (const service of services.splice(0)) {
    service.close()
    service.store.close()
  }
  vi.restoreAllMocks()
})

it('reads only summaries in indexed, complete history pages and keeps each workflow latest run', async () => {
  const { service, project, workflow } = await setup()
  const old = service.store.queue(workflow.id, false)
  service.store.review(old.id, rows(1000), { complete: 1, total: 1, failed: 0 })
  service.store.cancel(old.id)
  const second = service.store.save(project.id, 'Second', config)
  for (let i = 0; i < 24; i++) {
    const r = service.store.queue(second.id, false)
    service.store.review(r.id, rows(1000), { complete: 1, total: 1, failed: 0 })
    service.store.cancel(r.id)
  }
  const fullRead = vi.spyOn(service.store, 'run').mockImplementation(() => {
    throw Error('Full run must not be read during polling')
  })
  const first = service.state(project.id)
  const next = service.state(project.id, 20)
  expect(first.history).toEqual({ offset: 0, total: 25, limit: 20 })
  expect(first.runs).toHaveLength(20)
  expect(next.runs).toHaveLength(5)
  expect(new Set([...first.runs, ...next.runs].map((r) => r.id)).size).toBe(25)
  expect(first.latestRuns.some((r) => r.id === old.id)).toBe(true)
  expect(
    first.runs.every(
      (r) => r.hasCandidate && !('candidate' in r) && !('events' in r) && !('changes' in r),
    ),
  ).toBe(true)
  expect(JSON.stringify(first).length).toBeLessThan(20_000)
  expect(service.state(project.id, 0, workflow.id).history.total).toBe(1)
  expect(() => service.store.summary(old.id, 'other-project')).toThrow()
  expect(fullRead).not.toHaveBeenCalled()
})

it('pages table previews but retrieves complete evidence and prior values by cell identity', async () => {
  const { service, project, workflow } = await setup()
  const accepted = rows(205)
  let r = service.store.queue(workflow.id, false)
  service.store.review(r.id, accepted, { complete: 1, total: 1, failed: 0 })
  service.store.publish(r.id, accepted, 'fixture.xlsx')
  const candidate = rows(204)
  candidate.tables[0].rows[150].cells.total.value = 999
  r = service.store.queue(workflow.id, false)
  service.store.review(r.id, candidate, { complete: 1, total: 1, failed: 0 })
  const page = service.detail(project.id, r.id, { tableId: 'quotes', offset: 100 }).candidate!
    .tables[0]
  expect(page).toMatchObject({ offset: 100, totalRows: 204 })
  expect(page.rows).toHaveLength(100)
  expect(page.rows[50].cells.total).toMatchObject({ value: 999, evidence: [], evidenceCount: 1 })
  const details = service.cell(project.id, workflow.id, r.id, 'quotes', page.rows[50].id, 'total')
  expect(details.cell.evidence[0].locator).toBe('Text line 151')
  expect(details.prior?.value).toBe(150)
  expect(service.absent(project.id, r.id).rows.map((r) => r.row.id)).toEqual([
    accepted.tables[0].rows[204].id,
  ])
  expect(datasetPage(accepted, { offset: 200 })!.tables[0].rows).toHaveLength(5)
  expect(accepted.tables[0].rows[150].cells.total.evidence).toHaveLength(1)
  const other = service.store.save(project.id, 'Other', config)
  expect(() =>
    service.cell(project.id, other.id, r.id, 'quotes', page.rows[50].id, 'total'),
  ).toThrow('outside this workflow')
})

it('paginates actual absent rows against the entire candidate, not its preview', async () => {
  const { service, project, workflow } = await setup()
  const accepted = rows(250)
  const first = service.store.queue(workflow.id, false)
  service.store.review(first.id, accepted, { complete: 1, total: 1, failed: 0 })
  service.store.publish(first.id, accepted, 'fixture.xlsx')
  const next = service.store.queue(workflow.id, false)
  service.store.review(next.id, rows(10), { complete: 1, total: 1, failed: 0 })
  expect(service.absent(project.id, next.id)).toMatchObject({
    offset: 0,
    total: 240,
    rows: expect.any(Array),
  })
  expect(service.absent(project.id, next.id, 200).rows).toHaveLength(40)
  expect(service.absent(project.id, next.id, 200).rows[0].row.id).toBe(
    accepted.tables[0].rows[210].id,
  )
})

it('rejects oversized workbook evidence and ledger writes while preserving accepted revisions and corrections', async () => {
  const { service, workflow } = await setup()
  const initial = rows(1),
    first = service.store.queue(workflow.id, false)
  service.store.review(first.id, initial, { complete: 1, total: 1, failed: 0 })
  service.store.publish(first.id, initial, 'r1.xlsx')
  const large = rows(1)
  large.tables[0].rows[0].cells.total.evidence[0].excerpt = 'x'.repeat(RESEARCH_METADATA_LIMIT)
  await expect(projectDataset(large, workflow.id, 2)).rejects.toThrow('Split the input batch')
  const next = service.store.queue(workflow.id, false)
  service.store.review(next.id, large, { complete: 1, total: 1, failed: 0 })
  expect(() => service.store.publish(next.id, large, 'r2.xlsx')).toThrow('supported workbook size')
  expect(() =>
    service.store.correct(
      workflow.id,
      'quotes',
      large.tables[0].rows[0].id,
      'total',
      20,
      'Synthetic correction',
      large,
      'r2.xlsx',
      1,
    ),
  ).toThrow('supported workbook size')
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(1)
  expect(service.store.accepted(workflow.id)).toEqual(initial)
  expect(service.store.corrections(workflow.id)).toHaveLength(0)
  expect(service.store.run(next.id).status).toBe('review')
})

it('creates an independent project from workflow structure with no inputs, history, schedule or corrections', async () => {
  const { service, project, workflow } = await setup()
  service.store.schedule(workflow.id, 15, false)
  const r = service.store.queue(workflow.id, false),
    accepted = rows(1)
  service.store.review(r.id, accepted, { complete: 1, total: 1, failed: 0 })
  service.store.publish(r.id, accepted, 'fixture.xlsx')
  const id = await service.createFrom(
    project.id,
    workflow.id,
    'New template project',
    'Independent inputs',
  )
  const state = service.state(id),
    w = state.workflows[0]
  expect(id).not.toBe(project.id)
  expect(w.id).not.toBe(workflow.id)
  expect(w.config).toMatchObject({
    instructions: config.instructions,
    fields: config.fields,
    sourceIds: [],
    countries: [],
  })
  expect(w.config.parentWorkflowId).toBeUndefined()
  expect(w).toMatchObject({ scheduleMinutes: null, acceptedRevision: 0, destination: null })
  expect(state.runs).toEqual([])
  expect(service.workspace.get(id).workspace.sources).toEqual([])
  expect(service.store.corrections(w.id)).toEqual([])
  expect(service.store.accepted(w.id)).toBeNull()
  expect(() => service.run(id, w.id, false)).toThrow('Choose quote inputs')
})

it('keeps future engineering defaults immutable and checks independently authored expected locators', () => {
  expect(Object.isFrozen(ENGINEERING_POLICY)).toBe(true)
  expect(Object.isFrozen(ENGINEERING_POLICY.budgets)).toBe(true)
  expect(ENGINEERING_POLICY.budgets.maxCostUsd).toBe(0)
  expect(() => assertEngineeringCapability('execute-generated')).toThrow('isolated runner')
  expect(() => assertEngineeringCapability('send-private-to-cloud')).toThrow('not authorized')
  const directory = resolve('../../fixtures/infomonk/engineering')
  const corpus = JSON.parse(readFileSync(join(directory, 'expected.json'), 'utf8'))
  expect(corpus.heldOutCases).not.toContain(corpus.trainingExamples[0])
  for (const [name, expected] of Object.entries(corpus.cases) as [
    string,
    { total: number | null; totalLocator?: string; totalEvidenceLocators?: string[] },
  ][]) {
    const lines = readFileSync(join(directory, name), 'utf8').split(/\r?\n/)
    for (const locator of expected.totalEvidenceLocators ?? [expected.totalLocator!]) {
      const line = lines[Number(locator.match(/\d+$/)![0]) - 1]
      expect(line).toContain('Amount payable:')
      if (expected.total !== null)
        expect(Number(line.match(/[\d.]+/g)!.at(-1))).toBe(expected.total)
    }
  }
})
