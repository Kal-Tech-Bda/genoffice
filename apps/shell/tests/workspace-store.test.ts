import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { WorkspaceStore } from '../src/main/workspace-store'
import type { CleanupOptions } from '../src/shared/workspace-api'

describe('local project lifecycle', () => {
  it('persists metadata and native workbooks, preserves originals, guards stale previews and switches versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'infomonk-project-'))
    const source = join(root, 'source.tsv')
    writeFileSync(source, 'ID\tName\tAmount\n001\t Alpha \t10\n002\tBeta\t15')
    const original = readFileSync(source)
    const store = new WorkspaceStore(root)
    let project = await store.create({
      name: 'Suppliers',
      description: 'Review suppliers',
      filePath: source,
      delimiter: '\t',
    })
    project = store.update(project.id, { name: 'Supplier research', starred: true })
    expect(new WorkspaceStore(root).get(project.id)).toMatchObject({
      name: 'Supplier research',
      workspace: { starred: true, description: 'Review suppliers' },
    })
    const profile = await store.profile(project.id)
    const options: CleanupOptions = {
      sheetId: profile.sheetId,
      range: profile.range,
      hasHeader: true,
      trim: true,
      removeBlankRows: false,
      keys: [],
      deduplicate: false,
      sortColumn: null,
      descending: false,
      renames: {},
      formats: {},
    }
    const discarded = await store.preview(project.id, options)
    store.discard(discarded.token)
    await expect(store.apply(project.id, discarded.token)).rejects.toThrow('expired')
    const stale = await store.preview(project.id, options)
    const previous = readFileSync(project.workspace!.primaryWorkbook)
    writeFileSync(
      project.workspace!.primaryWorkbook,
      Buffer.concat([previous, Buffer.from('changed')]),
    )
    await expect(store.apply(project.id, stale.token)).rejects.toThrow('changed after preview')
    writeFileSync(project.workspace!.primaryWorkbook, previous)
    const preview = await store.preview(project.id, options)
    const applied = await store.apply(project.id, preview.token)
    expect(applied.workspace!.primaryWorkbook).not.toBe(project.workspace!.primaryWorkbook)
    expect(readFileSync(source)).toEqual(original)
    expect(store.undo(project.id).workspace!.primaryWorkbook).toBe(
      project.workspace!.primaryWorkbook,
    )
    const snapshot = store.get(project.id).workspace.sources[0]!
    const viewingCopy = await store.sourcePreviewPath(project.id, snapshot.id)
    writeFileSync(viewingCopy, 'Edited viewing copy')
    expect(readFileSync(snapshot.snapshotPath!)).toEqual(original)
  })
})
