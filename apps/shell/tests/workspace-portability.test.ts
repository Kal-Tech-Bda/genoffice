import { expect, it } from 'vitest'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { WorkspaceStore } from '../src/main/workspace-store'
import { ResearchService } from '../src/main/research/service'
import { quoteColumns } from '../src/main/research/extract'
import {
  relocateWorkspace,
  startWorkspaceSession,
  transferWorkspace,
} from '../src/main/workspace-portability'

it('backs up and restores owned evidence, workbooks, chats and overrides with the original profile unavailable', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'infomonk-portability-'))
  const source = join(sandbox, 'source'),
    bundle = join(sandbox, 'backup'),
    restored = join(sandbox, 'restored')
  mkdirSync(source)
  const workspace = new WorkspaceStore(source)
  const original = resolve('../../fixtures/infomonk/research/valid.txt')
  const project = await workspace.create({
    name: 'Portable synthetic quotes',
    description: '',
    filePath: original,
  })
  const service = new ResearchService(source, workspace)
  let w, run, accepted
  try {
    w = service.save(project.id, 'Quotes', {
      kind: 'quotes',
      instructions: 'Labeled quotes',
      sourceIds: project.workspace!.sources.map((s) => s.id),
      fields: quoteColumns.map((c) => c.id),
      countries: [],
      fromYear: 2023,
      toYear: 2024,
    })
    run = service.run(project.id, w.id, false)
    const deadline = Date.now() + 10_000
    while (service.store.run(run.id).status !== 'review' && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 10))
    expect(service.store.run(run.id).status).toBe('review')
    await service.publish(project.id, run.id, true, false)
    accepted = service.store.accepted(w.id)!
    await service.correct(
      project.id,
      w.id,
      'quotes',
      accepted.tables[0].rows[0].id,
      'total',
      130,
      'Reviewed synthetic adjustment',
    )
    service.store.schedule(w.id, 15, false)
    service.store.queue(w.id, false)
    const chat = join(source, 'projects', project.id, 'chats', 'portable.jsonl')
    mkdirSync(join(chat, '..'), { recursive: true })
    writeFileSync(
      chat,
      JSON.stringify({
        role: 'user',
        text: `Keep historical text ${source}`,
        fileRef: project.workspace!.primaryWorkbook,
        attachments: [{ path: project.workspace!.sources[0].snapshotPath }],
      }) + '\n',
    )
    // Credential/settings files are intentionally outside the backup allowlist.
    writeFileSync(join(source, 'app-settings.json'), '{"privateDummySecret":"never copy"}')
  } finally {
    service.close()
    service.store.close()
  }
  await transferWorkspace('backup', source, bundle)
  expect(existsSync(join(bundle, 'app-settings.json'))).toBe(false)
  const hidden = join(sandbox, 'source-unavailable')
  for (const path of [source, hidden]) {
    const part = relative(sandbox, resolve(path))
    if (!part || isAbsolute(part) || part.startsWith('..')) throw Error('Test move escaped sandbox')
  }
  renameSync(source, hidden)
  await transferWorkspace('restore', bundle, restored)
  const nextWorkspace = new WorkspaceStore(restored),
    next = new ResearchService(restored, nextWorkspace)
  try {
    const p = nextWorkspace.get(project.id)
    expect(p.workspace.primaryWorkbook.startsWith(restored)).toBe(true)
    expect(existsSync(p.workspace.primaryWorkbook)).toBe(true)
    expect(p.workspace.sources[0].snapshotPath!.startsWith(restored)).toBe(true)
    expect(p.workspace.sources[0].uri).toBe(original)
    const state = next.state(project.id)
    expect(state.workflows[0]).toMatchObject({ acceptedRevision: 2, paused: true })
    expect(state.workflows[0].destination!.startsWith(restored)).toBe(true)
    expect(state.runs.find((r) => r.status === 'failed')?.error).toContain('Restored backup')
    const data = next.store.accepted(w!.id)!,
      target = data.tables[0].rows[0].cells.total
    expect(target.value).toBe(130)
    expect(next.store.corrections(w!.id)).toHaveLength(1)
    expect(next.store.inputs(run!.id)[0].path.startsWith(restored)).toBe(true)
    expect(await next.evidence(project.id, target.evidence[0])).toMatchObject({
      text: 'Total: 125.50',
      locator: 'Text line 6',
    })
    const details = await next.sheetCell(state.workflows[0].destination!, {
      tableId: 'quotes',
      rowId: data.tables[0].rows[0].id,
      columnId: 'total',
      value: 130,
    })
    expect(details?.cell.value).toBe(130)
    const message = JSON.parse(
      readFileSync(join(restored, 'projects', project.id, 'chats', 'portable.jsonl'), 'utf8'),
    )
    expect(message.text).toContain(source)
    expect(message.fileRef.startsWith(restored)).toBe(true)
    expect(message.attachments[0].path.startsWith(restored)).toBe(true)
    expect(relocateWorkspace(restored).relocated).toBe(false)
  } finally {
    next.close()
    next.store.close()
  }
})

it('rejects open workspaces, concurrent maintenance, overwrites and nested destinations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-lock-'))
  const end = startWorkspaceSession(root)
  await expect(transferWorkspace('backup', root, root + '-new')).rejects.toThrow('Close Infomonk')
  end()
  writeFileSync(join(root, 'infomonk-maintenance.json'), JSON.stringify({ pid: process.pid }))
  expect(() => startWorkspaceSession(root)).toThrow('in progress')
  await expect(transferWorkspace('backup', root, root + '-new')).rejects.toThrow('in progress')
  await expect(transferWorkspace('backup', root, root)).rejects.toThrow('new destination')
  await expect(transferWorkspace('backup', root, join(root, 'nested'))).rejects.toThrow(
    'separate folders',
  )
})

it('retries a legacy copied-profile migration after an interrupted database step', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'infomonk-relocation-retry-'))
  const source = join(sandbox, 'source'),
    copy = join(sandbox, 'copy')
  mkdirSync(source)
  const workspace = new WorkspaceStore(source)
  const p = await workspace.create({ name: 'Legacy copy', description: '' })
  const service = new ResearchService(source, workspace)
  const w = service.store.save(p.id, 'Quotes', {
    kind: 'quotes',
    instructions: '',
    sourceIds: [],
    fields: ['quote_id'],
    countries: [],
    fromYear: 2023,
    toYear: 2024,
  })
  const run = service.store.queue(w.id, false)
  service.store.db.prepare('INSERT INTO inputs VALUES(?,?,?)').run(run.id, 0, 'broken fixture JSON')
  service.close()
  service.store.close()
  cpSync(source, copy, { recursive: true, errorOnExist: true, force: false })
  expect(() => relocateWorkspace(copy)).toThrow()
  expect(JSON.parse(readFileSync(join(copy, 'infomonk-workspace.json'), 'utf8')).root).toBe(source)
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(copy, 'infomonk-research.sqlite'))
  db.prepare('UPDATE inputs SET data=?').run(JSON.stringify({ path: p.workspace!.primaryWorkbook }))
  db.close()
  expect(relocateWorkspace(copy).relocated).toBe(true)
  expect(new WorkspaceStore(copy).get(p.id).workspace.primaryWorkbook.startsWith(copy)).toBe(true)
  const migrated = new ResearchService(copy, new WorkspaceStore(copy))
  try {
    expect(migrated.store.inputs(run.id)[0].path.startsWith(copy)).toBe(true)
  } finally {
    migrated.close()
    migrated.store.close()
  }
  expect(relocateWorkspace(copy).relocated).toBe(false)
})
