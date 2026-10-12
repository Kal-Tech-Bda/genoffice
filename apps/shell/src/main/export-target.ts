import { lstat, realpath, stat } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { WorkspaceStore } from './workspace-store'

const MAX_PROTECTED_PATHS = 10_000
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === 'ENOENT' ||
  (error as NodeJS.ErrnoException).code === 'ENOTDIR'
const key = (path: string) => {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}
function inside(path: string, root: string): boolean {
  const part = relative(key(root), key(path))
  return part === '' || (part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part))
}
function sameFile(a: BigIntStats | undefined, b: BigIntStats | undefined): boolean {
  return !!a && !!b && a.ino !== 0n && b.ino !== 0n && a.dev === b.dev && a.ino === b.ino
}

/** Read registered project metadata only; never scan folders or mutate workspace.list(). */
export function workspaceExportProtectedPaths(workspace: WorkspaceStore): string[] {
  const paths = new Set<string>()
  const add = (path: string | undefined) => {
    if (path && isAbsolute(path)) paths.add(resolve(path))
    if (paths.size > MAX_PROTECTED_PATHS)
      throw new Error('Too many registered file paths to verify an export destination.')
  }
  for (const info of workspace.projects.listProjects()) {
    const project = workspace.projects.getProject(info.id)
    if (!project) continue
    project.files.forEach(add)
    const metadata = project.workspace
    if (!metadata) continue
    add(metadata.primaryWorkbook)
    add(metadata.workingWorkbook)
    add(metadata.previousWorkbook)
    for (const source of metadata.sources) {
      add(source.uri)
      add(source.snapshotPath)
      for (const version of source.previousVersions ?? []) {
        add(version.uri)
        add(version.snapshotPath)
      }
    }
  }
  return [...paths]
}

/** Validate an external XLSX save destination without creating, deleting or writing any file. */
export async function exportTarget(
  target: string,
  userData: string,
  protectedPaths: string[],
): Promise<string> {
  if (
    typeof target !== 'string' ||
    target.length > 4096 ||
    target.includes('\0') ||
    !isAbsolute(target) ||
    extname(target).toLowerCase() !== '.xlsx' ||
    !isAbsolute(userData) ||
    (process.platform === 'win32' &&
      (/^\\\\[?.]\\/.test(target) ||
        basename(target).includes(':') ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename(target))))
  )
    throw new Error('Choose an ordinary absolute .xlsx export file path.')
  if (protectedPaths.length > MAX_PROTECTED_PATHS)
    throw new Error('Too many registered file paths to verify an export destination.')
  const absolute = resolve(target)
  const protectedFiles = [
    ...new Set(protectedPaths.filter(isAbsolute).map((path) => resolve(path))),
  ]
  const protectedKeys = new Set(protectedFiles.map(key))
  if (inside(absolute, userData) || protectedKeys.has(key(absolute)))
    throw new Error(
      'Export outside the managed workspace and original or registered project files.',
    )

  const managed = await realpath(userData)
  const parent = await realpath(dirname(absolute)).catch(() => {
    throw new Error('Choose an existing export destination folder.')
  })
  if (!(await stat(parent)).isDirectory()) throw new Error('Choose an export destination folder.')
  let actual = join(parent, basename(absolute))
  let targetStat: BigIntStats | undefined
  const targetEntry = await lstat(absolute).catch((error: unknown) => {
    if (missing(error)) return null
    throw error
  })
  if (targetEntry) {
    actual = await realpath(absolute).catch(() => {
      throw new Error('The export destination alias cannot be resolved safely.')
    })
    targetStat = await stat(actual, { bigint: true })
    if (!targetStat.isFile()) throw new Error('Choose an export file, not a directory or device.')
    // A hard link's other names cannot be found by realpath without scanning
    // the filesystem. Copy exports would overwrite all linked names, including
    // unregistered files in userData, so an existing linked target fails closed.
    if (targetStat.nlink > 1n)
      throw new Error('Hard-link aliases are not safe export destinations.')
  }
  if (inside(parent, managed) || inside(actual, managed) || protectedKeys.has(key(actual)))
    throw new Error(
      'Export outside the managed workspace and original or registered project files.',
    )

  for (const file of protectedFiles) {
    let canonical: string
    let fileStat: BigIntStats | undefined
    try {
      canonical = await realpath(file)
      if (targetStat) fileStat = await stat(canonical, { bigint: true })
    } catch (error) {
      if (!missing(error))
        throw new Error('Cannot verify a protected project file alias.', { cause: error })
      const entry = await lstat(file).catch((failure: unknown) => {
        if (missing(failure)) return null
        throw failure
      })
      if (entry?.isSymbolicLink())
        throw new Error('Cannot verify a protected project file alias.', { cause: error })
      const directory = await realpath(dirname(file)).catch((failure: unknown) => {
        if (missing(failure)) return null
        throw failure
      })
      if (!directory) continue
      canonical = join(directory, basename(file))
    }
    if (key(actual) === key(canonical) || sameFile(targetStat, fileStat))
      throw new Error('The export destination aliases an original or registered project file.')
  }
  return absolute
}
