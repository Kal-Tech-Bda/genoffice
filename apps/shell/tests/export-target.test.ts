import { expect, it, vi } from 'vitest'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exportTarget, workspaceExportProtectedPaths } from '../src/main/export-target'
import { WorkspaceStore } from '../src/main/workspace-store'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'infomonk-export-target-')),
    userData = join(root, 'managed'),
    external = join(root, 'external'),
    original = join(external, 'supplier-original.xlsx')
  mkdirSync(userData)
  mkdirSync(external)
  writeFileSync(original, 'original workbook bytes')
  return { root, userData, external, original }
}

it('accepts a new external XLSX and an explicit external overwrite without writing either destination', async () => {
  const { userData, external, original } = fixture()
  const destination = join(external, 'snapshot.XLSX')
  expect(await exportTarget(destination, userData, [original])).toBe(resolve(destination))
  expect(existsSync(destination)).toBe(false)
  writeFileSync(destination, 'previous exported snapshot')
  expect(await exportTarget(destination, userData, [original])).toBe(resolve(destination))
  expect(readFileSync(destination, 'utf8')).toBe('previous exported snapshot')
  expect(readFileSync(original, 'utf8')).toBe('original workbook bytes')
})

it('rejects original, registered and managed destinations before a writer can overwrite them', async () => {
  const { userData, external, original } = fixture()
  const managed = join(userData, 'workbook.xlsx'),
    registered = join(external, 'registered.xlsx'),
    previous = join(external, 'previous-source.xlsx')
  for (const path of [managed, registered, previous]) writeFileSync(path, 'protected bytes')
  for (const path of [original, managed, registered, previous, join(userData, 'not-created.xlsx')])
    await expect(exportTarget(path, userData, [original, registered, previous])).rejects.toThrow(
      'outside',
    )
  await expect(
    exportTarget(join(external, 'nested', '..', 'supplier-original.xlsx'), userData, [original]),
  ).rejects.toThrow('original')
  expect(readFileSync(original, 'utf8')).toBe('original workbook bytes')
  expect(readFileSync(previous, 'utf8')).toBe('protected bytes')
  expect(existsSync(join(userData, 'not-created.xlsx'))).toBe(false)
})

it('distinguishes a similarly named external sibling from the managed root and validates file/folder bounds', async () => {
  const { root, userData, external } = fixture()
  const sibling = userData + '-exports'
  mkdirSync(sibling)
  expect(await exportTarget(join(sibling, 'snapshot.xlsx'), userData, [])).toBe(
    join(sibling, 'snapshot.xlsx'),
  )
  for (const path of [
    'relative.xlsx',
    join(external, 'copy.csv'),
    'https://example.test/table.xlsx',
    join(external, 'bad\0.xlsx'),
  ])
    await expect(exportTarget(path, userData, [])).rejects.toThrow('absolute .xlsx')
  await expect(
    exportTarget(join(root, 'absent-folder', 'snapshot.xlsx'), userData, []),
  ).rejects.toThrow('existing')
  const directory = join(external, 'directory.xlsx')
  mkdirSync(directory)
  await expect(exportTarget(directory, userData, [])).rejects.toThrow('not a directory')
  await expect(
    exportTarget(
      join(external, 'copy.xlsx'),
      userData,
      Array.from({ length: 10001 }, () => 'relative'),
    ),
  ).rejects.toThrow('Too many')
})

it.skipIf(process.platform !== 'win32')(
  'rejects Windows case aliases, alternate streams and device namespace destinations',
  async () => {
    const { userData, external, original } = fixture()
    await expect(exportTarget(original.toUpperCase(), userData, [original])).rejects.toThrow(
      'original',
    )
    await expect(
      exportTarget(join(userData.toUpperCase(), 'COPY.XLSX'), userData, []),
    ).rejects.toThrow('managed')
    for (const path of [
      join(external, 'supplier-original.xlsx:copy.xlsx'),
      join(external, 'CON.xlsx'),
      '\\\\?\\' + join(external, 'copy.xlsx'),
    ])
      await expect(exportTarget(path, userData, [])).rejects.toThrow('ordinary')
  },
)

it('protects existing hard-link aliases of original files', async () => {
  const { userData, external, original } = fixture()
  const alias = join(external, 'original-hard-link.xlsx')
  linkSync(original, alias)
  await expect(exportTarget(alias, userData, [original])).rejects.toThrow('aliases')
  expect(readFileSync(original, 'utf8')).toBe('original workbook bytes')
})

it('rejects hard links to unregistered managed files without requiring a folder scan', async () => {
  const { userData, external } = fixture()
  const settings = join(userData, 'app-settings.json'),
    alias = join(external, 'settings-alias.xlsx')
  writeFileSync(settings, 'managed settings must not change')
  linkSync(settings, alias)
  await expect(exportTarget(alias, userData, [])).rejects.toThrow('Hard-link aliases')
  expect(readFileSync(settings, 'utf8')).toBe('managed settings must not change')
})

it('protects an external directory alias into managed userData', async (context) => {
  const { root, userData } = fixture()
  const alias = join(root, 'managed-alias')
  try {
    symlinkSync(userData, alias, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (
      process.platform === 'win32' &&
      ['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      context.skip('Windows does not permit this directory alias fixture.')
    throw error
  }
  await expect(exportTarget(join(alias, 'new-copy.xlsx'), userData, [])).rejects.toThrow('managed')
  expect(existsSync(join(userData, 'new-copy.xlsx'))).toBe(false)
})

it('protects both sides of a file symlink and rejects an unresolvable destination alias', async (context) => {
  const { userData, external, original } = fixture()
  const alias = join(external, 'original-symlink.xlsx'),
    dangling = join(external, 'dangling.xlsx')
  try {
    symlinkSync(original, alias, 'file')
    symlinkSync(join(external, 'missing.xlsx'), dangling, 'file')
  } catch (error) {
    if (
      process.platform === 'win32' &&
      ['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')
    )
      context.skip('Windows does not permit this file symlink fixture.')
    throw error
  }
  await expect(exportTarget(alias, userData, [original])).rejects.toThrow('project files')
  await expect(exportTarget(original, userData, [alias])).rejects.toThrow('aliases')
  await expect(exportTarget(dangling, userData, [])).rejects.toThrow('cannot be resolved')
  expect(readFileSync(original, 'utf8')).toBe('original workbook bytes')
})

it('collects originals, registered files and prior versions directly from metadata without scanning or changing the workspace', () => {
  const { userData, external, original } = fixture()
  const workspace = new WorkspaceStore(userData),
    project = workspace.projects.createProject('Export registry'),
    registered = join(external, 'registered.xlsx'),
    previous = join(external, 'previous.xlsx'),
    primary = join(userData, 'projects', project.id, 'workspace', 'Workbook.xlsx'),
    working = join(userData, 'current.xlsx'),
    previousWorkbook = join(userData, 'previous-workbook.xlsx'),
    snapshot = join(userData, 'source-current.xlsx'),
    oldSnapshot = join(userData, 'source-previous.xlsx')
  writeFileSync(registered, 'registered file')
  workspace.projects.moveFileToProject(registered, project.id)
  workspace.projects.updateWorkspace(project.id, {
    version: 1,
    description: 'Registry protection fixture',
    starred: false,
    primaryWorkbook: primary,
    workingWorkbook: working,
    previousWorkbook,
    sources: [
      {
        id: 'source',
        name: 'Original',
        uri: original,
        snapshotPath: snapshot,
        addedAt: '2026-10-12T00:00:00Z',
        previousVersions: [
          {
            name: 'Previous',
            uri: previous,
            snapshotPath: oldSnapshot,
            addedAt: '2026-10-11T00:00:00Z',
          },
        ],
      },
      {
        id: 'web',
        name: 'Public URL',
        uri: 'https://example.test/file.xlsx',
        addedAt: '2026-10-12T00:00:00Z',
      },
      { id: 'relative', name: 'Relative', uri: 'relative.xlsx', addedAt: '2026-10-12T00:00:00Z' },
    ],
    activity: [],
  })
  mkdirSync(join(userData, 'projects', project.id, 'workspace'), { recursive: true })
  const unregistered = join(userData, 'projects', project.id, 'workspace', 'unregistered.pdf')
  writeFileSync(unregistered, 'not registered')
  const before = JSON.stringify(workspace.projects.getProject(project.id))
  const list = vi.spyOn(workspace, 'list').mockImplementation(() => {
    throw Error('Do not scan workspace.list')
  })
  const paths = workspaceExportProtectedPaths(workspace)
  expect(paths.sort()).toEqual(
    [
      registered,
      primary,
      working,
      previousWorkbook,
      original,
      snapshot,
      previous,
      oldSnapshot,
    ].sort(),
  )
  expect(paths).not.toContain(unregistered)
  expect(list).not.toHaveBeenCalled()
  expect(JSON.stringify(workspace.projects.getProject(project.id))).toBe(before)
})
