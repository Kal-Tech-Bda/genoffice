import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, resolve, win32 } from 'node:path'
import { randomUUID } from 'node:crypto'
import { backup, DatabaseSync } from 'node:sqlite'

const markerName = 'infomonk-workspace.json'
const sessionName = 'infomonk-session.json'
const lockName = 'infomonk-maintenance.json'
function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))
}
function atomicJson(path: string, value: unknown): void {
  const temporary = path + '.' + randomUUID() + '.tmp'
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  renameSync(temporary, path)
}
function alive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || Number(pid) <= 0) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
export function assertWorkspaceClosed(root: string): void {
  for (const name of [sessionName, 'dev-instance.pid']) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    const pid = name.endsWith('.pid')
      ? Number(readFileSync(path, 'utf8').trim())
      : readJson(path).pid
    if (alive(pid)) throw new Error('Close Infomonk before backing up or restoring this workspace.')
  }
}
export function startWorkspaceSession(root: string): () => void {
  mkdirSync(root, { recursive: true })
  const path = join(root, sessionName)
  const unlock = acquireMaintenance(root)
  try {
    assertWorkspaceClosed(root)
    atomicJson(path, { pid: process.pid })
  } finally {
    unlock()
  }
  return () => {
    if (existsSync(path) && readJson(path).pid === process.pid) unlinkSync(path)
  }
}
function acquireMaintenance(root: string): () => void {
  const lock = join(root, lockName)
  if (existsSync(lock)) {
    if (alive(readJson(lock).pid)) throw new Error('A workspace backup or restore is in progress.')
    unlinkSync(lock)
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid }), { flag: 'wx' })
  return () => unlinkSync(lock)
}
function projectFiles(root: string): string[] {
  const dir = join(root, 'projects')
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(dir, d.name, 'project.json'))
        .filter(existsSync)
    : []
}
function oldRootFrom(path: string, projectId: string): string | undefined {
  const normalized = path.replaceAll('\\', '/')
  const marker = `/projects/${projectId}/workspace/`
  const at = normalized.indexOf(marker)
  return at > 0 ? path.slice(0, at) : undefined
}
function ownedMapper(oldRoot: string, newRoot: string): (value: string) => string {
  const flavor = /^[A-Za-z]:[\\/]|^\\\\/.test(oldRoot) ? win32 : { relative }
  return (value) => {
    const part = flavor.relative(oldRoot, value)
    if (/^(\.\.(?:[\\/]|$)|[A-Za-z]:|[\\/])/.test(part) || !/^projects[\\/]/.test(part))
      return value
    const target = resolve(newRoot, ...part.split(/[\\/]/))
    if (relative(join(newRoot, 'projects'), target).startsWith('..'))
      throw new Error('Invalid owned workspace path.')
    return target
  }
}
/** Idempotent legacy migration. The old-root marker survives a crash until all stores are relocated. */
export function relocateWorkspace(root: string): { relocated: boolean; oldRoot: string } {
  root = resolve(root)
  mkdirSync(root, { recursive: true })
  const marker = join(root, markerName),
    files = projectFiles(root)
  let oldRoot: string
  if (existsSync(marker)) {
    const recorded = readJson(marker)
    if (recorded.version !== 1 || typeof recorded.root !== 'string')
      throw new Error('Unsupported workspace location record.')
    oldRoot = recorded.root
  } else {
    const roots = new Set(
      files.flatMap((path) => {
        const p = readJson(path)
        return p.workspace
          ? [oldRootFrom(p.workspace.primaryWorkbook, p.id)].filter(
              (r): r is string => !!r && resolve(r) !== root,
            )
          : []
      }),
    )
    if (roots.size > 1)
      throw new Error('Workspace has mixed owned roots; restore a consistent backup.')
    oldRoot = [...roots][0] ?? root
    atomicJson(marker, { version: 1, root: oldRoot })
  }
  if (resolve(oldRoot).toLowerCase() === root.toLowerCase()) return { relocated: false, oldRoot }
  const map = ownedMapper(oldRoot, root)
  for (const path of files) {
    const p = readJson(path)
    p.files = (p.files ?? []).map(map)
    if (p.workspace) {
      p.workspace.primaryWorkbook = map(p.workspace.primaryWorkbook)
      if (p.workspace.workingWorkbook)
        p.workspace.workingWorkbook = map(p.workspace.workingWorkbook)
      if (p.workspace.previousWorkbook)
        p.workspace.previousWorkbook = map(p.workspace.previousWorkbook)
      for (const source of p.workspace.sources) {
        if (source.snapshotPath) source.snapshotPath = map(source.snapshotPath)
        for (const previous of source.previousVersions ?? [])
          if (previous.snapshotPath) previous.snapshotPath = map(previous.snapshotPath)
      }
    }
    atomicJson(path, p)
    const chats = join(path.replace(/project\.json$/, ''), 'chats')
    if (existsSync(chats))
      for (const name of readdirSync(chats).filter((n) => n.endsWith('.jsonl'))) {
        const chatPath = join(chats, name)
        const lines = readFileSync(chatPath, 'utf8')
          .split('\n')
          .map((line) => {
            if (!line.trim()) return line
            try {
              const message = JSON.parse(line)
              if (typeof message.fileRef === 'string') message.fileRef = map(message.fileRef)
              for (const attachment of message.attachments ?? [])
                if (typeof attachment.path === 'string') attachment.path = map(attachment.path)
              return JSON.stringify(message)
            } catch {
              return line
            }
          })
        const temporary = chatPath + '.' + randomUUID() + '.tmp'
        writeFileSync(temporary, lines.join('\n'), { flag: 'wx' })
        renameSync(temporary, chatPath)
      }
  }
  const indexPath = join(root, 'projects', 'index.json')
  if (existsSync(indexPath)) {
    const index = readJson(indexPath)
    for (const key of ['fileMap', 'chatIdByPath'])
      if (index[key])
        index[key] = Object.fromEntries(
          Object.entries(index[key]).map(([path, value]) => [map(path), value]),
        )
    atomicJson(indexPath, index)
  }
  const database = join(root, 'infomonk-research.sqlite')
  if (existsSync(database)) {
    const db = new DatabaseSync(database)
    try {
      db.exec('BEGIN IMMEDIATE')
      for (const table of ['workflows', 'revisions'])
        for (const row of db
          .prepare(`SELECT rowid,destination FROM ${table} WHERE destination IS NOT NULL`)
          .all())
          db.prepare(`UPDATE ${table} SET destination=? WHERE rowid=?`).run(
            map(String(row.destination)),
            row.rowid,
          )
      for (const row of db.prepare('SELECT rowid,data FROM inputs').iterate()) {
        const input = JSON.parse(String(row.data))
        input.path = map(input.path)
        db.prepare('UPDATE inputs SET data=? WHERE rowid=?').run(JSON.stringify(input), row.rowid)
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    } finally {
      db.close()
    }
  }
  atomicJson(marker, { version: 1, root })
  return { relocated: true, oldRoot }
}
function copyProjects(source: string, destination: string): void {
  const folder = join(source, 'projects')
  if (!existsSync(folder)) return
  cpSync(folder, join(destination, 'projects'), {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (path) => {
      if (lstatSync(path).isSymbolicLink())
        throw new Error('Workspace backups do not follow symbolic links or directory junctions.')
      return true
    },
  })
}
/** Closed-profile data backup. Provider settings, credentials, caches and external original files are excluded. */
export async function transferWorkspace(
  mode: 'backup' | 'restore',
  source: string,
  destination: string,
): Promise<void> {
  source = resolve(source)
  destination = resolve(destination)
  if (!existsSync(source) || existsSync(destination))
    throw new Error('Choose an existing source and a new destination folder.')
  const inside = (base: string, path: string) => {
    const part = relative(base, path)
    return !part || (!isAbsolute(part) && !part.startsWith('..'))
  }
  if (inside(source, destination) || inside(destination, source))
    throw new Error('Source and destination must be separate folders.')
  const unlock = acquireMaintenance(source)
  const staging = destination + '.partial-' + randomUUID()
  let moved = false
  try {
    assertWorkspaceClosed(source)
    if (mode === 'restore' && readJson(join(source, 'infomonk-backup.json')).version !== 1)
      throw new Error('Unsupported backup version.')
    if (mode === 'backup') relocateWorkspace(source)
    mkdirSync(staging)
    writeFileSync(join(staging, lockName), JSON.stringify({ pid: process.pid }), { flag: 'wx' })
    copyProjects(source, staging)
    const sourceDb = join(source, 'infomonk-research.sqlite')
    if (existsSync(sourceDb)) {
      const db = new DatabaseSync(sourceDb, { readOnly: true })
      try {
        if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok')
          throw new Error('Research database integrity check failed.')
        await backup(db, join(staging, 'infomonk-research.sqlite'))
      } finally {
        db.close()
      }
    }
    cpSync(join(source, markerName), join(staging, markerName), {
      errorOnExist: true,
      force: false,
    })
    atomicJson(join(staging, 'infomonk-backup.json'), {
      version: 1,
      createdAt: new Date().toISOString(),
      contents:
        'Project metadata/chats, owned files/snapshots and consistent research database; no provider credentials or external originals.',
    })
    // Fence restored automation before the new folder can be opened, even after a crash.
    const stagedDatabase = join(staging, 'infomonk-research.sqlite')
    if (mode === 'restore' && existsSync(stagedDatabase)) {
      const db = new DatabaseSync(stagedDatabase)
      try {
        db.exec(
          "BEGIN IMMEDIATE; UPDATE workflows SET paused=1 WHERE schedule_minutes IS NOT NULL; UPDATE runs SET status='failed',error='Restored backup; review inputs and retry manually.' WHERE status IN ('queued','acquiring','processing'); COMMIT;",
        )
      } finally {
        db.close()
      }
    }
    // Both the source and destination remain intact if any later relocation step needs retrying.
    renameSync(staging, destination)
    moved = true
    if (mode === 'restore') relocateWorkspace(destination)
  } finally {
    const destinationLock = join(moved ? destination : staging, lockName)
    if (existsSync(destinationLock)) unlinkSync(destinationLock)
    unlock()
  }
}
