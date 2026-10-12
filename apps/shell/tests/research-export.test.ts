import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { WorkspaceStore } from '../src/main/workspace-store'
import { ResearchService } from '../src/main/research/service'
import { quoteColumns } from '../src/main/research/extract'

const services: ResearchService[] = []
afterEach(() => {
  for (const service of services.splice(0)) {
    service.close()
    service.store.close()
  }
})
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'infomonk-export-'))
  const profile = join(directory, 'profile')
  const workspace = new WorkspaceStore(profile)
  const project = await workspace.create({
    name: 'Quote export',
    description: '',
    filePath: resolve('../../fixtures/infomonk/research/valid.txt'),
  })
  const service = new ResearchService(profile, workspace)
  services.push(service)
  const workflow = service.save(project.id, 'Supplier quotes', {
    kind: 'quotes',
    instructions: 'Synthetic quote export',
    sourceIds: project.workspace!.sources.map((s) => s.id),
    fields: quoteColumns.map((c) => c.id),
    countries: ['CAN'],
    fromYear: 2025,
    toYear: 2026,
  })
  const run = service.run(project.id, workflow.id, false)
  await vi.waitFor(() => expect(service.store.run(run.id).status).toBe('review'))
  const path = await service.publish(project.id, run.id, true, false)
  return { directory, workspace, service, project, workflow, path }
}
async function exported(path: string) {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const metadata = JSON.parse(await zip.file('infomonk/research.json')!.async('string'))
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  return { metadata, xml }
}

it('exports the exact accepted revision after its editable projection has changed, preserving typed facts and evidence', async () => {
  const { directory, workspace, service, project, workflow, path } = await setup()
  const accepted = service.store.accepted(workflow.id)!
  const zip = await JSZip.loadAsync(readFileSync(path))
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  expect(xml).toContain('<v>125.5</v>')
  zip.file('xl/worksheets/sheet1.xml', xml.replace('<v>125.5</v>', '<v>999</v>'))
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }))
  const changedProjection = readFileSync(path)
  const before = workspace.get(project.id)
  const output = join(directory, 'accepted-r1.xlsx')
  await service.exportAccepted(project.id, workflow.id, 1, output)
  const result = await exported(output)
  expect(result.xml).toContain('<v>125.5</v>')
  expect(result.xml).not.toContain('<v>999</v>')
  expect(result.metadata.revision).toBe(1)
  expect(result.metadata.dataset).toEqual(accepted)
  expect(result.metadata.dataset.tables[0].rows[0].cells.total.evidence[0].locator).toMatch(
    /^Text line/,
  )
  expect(result.xml).toContain('hidden="1"')
  expect(readFileSync(path)).toEqual(changedProjection)
  expect(workspace.get(project.id)).toEqual(before)
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(1)
})

it('exports earlier accepted facts independently of a later reviewer correction', async () => {
  const { directory, service, project, workflow } = await setup()
  const row = service.store.accepted(workflow.id)!.tables[0].rows[0]
  await service.correct(
    project.id,
    workflow.id,
    'quotes',
    row.id,
    'total',
    133.5,
    'Synthetic reviewer correction',
  )
  const first = join(directory, 'accepted-r1.xlsx')
  const second = join(directory, 'accepted-r2.xlsx')
  await service.exportAccepted(project.id, workflow.id, 1, first)
  await service.exportAccepted(project.id, workflow.id, 2, second)
  const [original, corrected] = await Promise.all([exported(first), exported(second)])
  expect(original.metadata.dataset.tables[0].rows[0].cells.total.value).toBe(125.5)
  expect(corrected.metadata.dataset.tables[0].rows[0].cells.total.value).toBe(133.5)
  expect(corrected.metadata.dataset.tables[0].rows[0].cells.total.origin).toBe('manual')
  expect(original.metadata.revision).toBe(1)
  expect(corrected.metadata.revision).toBe(2)
  expect(service.store.workflow(workflow.id).acceptedRevision).toBe(2)
})

it('rejects absent revisions, foreign workflows and targets that could overwrite managed data', async () => {
  const { directory, workspace, service, project, workflow, path } = await setup()
  const target = join(directory, 'export.xlsx')
  const other = await workspace.create({ name: 'Other project', description: '' })
  await expect(service.exportAccepted(other.id, workflow.id, 1, target)).rejects.toThrow()
  await expect(service.exportAccepted(project.id, workflow.id, 0, target)).rejects.toThrow(
    'published accepted',
  )
  await expect(service.exportAccepted(project.id, workflow.id, 99, target)).rejects.toThrow(
    'not found',
  )
  const original = readFileSync(path)
  await expect(service.exportAccepted(project.id, workflow.id, 1, path)).rejects.toThrow()
  expect(readFileSync(path)).toEqual(original)
})
