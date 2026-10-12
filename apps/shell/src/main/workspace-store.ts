import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { readFile, copyFile } from 'node:fs/promises'
import { basename, extname, join, isAbsolute, relative } from 'node:path'
import { ProjectStore, type ProjectData, type WorkspaceSource } from '@genoffice/project-store'
import {
  decodeCsvBuffer,
  parseCsv,
  resolveImportDelimiter,
  sheetCsvToXlsxBuffer,
} from '@genoffice/xlsx-gateway/gateway/csv-import'
import { writeXlsxAtomically } from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'
import { buildCleanWorkbook, digest, loadTable, planCleanup, type CleanPlan } from './clean-table'
import type { CleanupOptions, CreateWorkspace } from '../shared/workspace-api'

export class WorkspaceStore {
  readonly projects: ProjectStore
  private readonly previews = new Map<
    string,
    { id: string; path: string; plan: CleanPlan; created: number }
  >()
  private readonly busy = new Set<string>()
  constructor(private readonly userData: string) {
    this.projects = new ProjectStore(userData)
  }
  get(id: string): ProjectData & { workspace: NonNullable<ProjectData['workspace']> } {
    const project = this.projects.getProject(id)
    if (!project?.workspace || project.workspace.version !== 1)
      throw new Error('Project not found.')
    return project as ProjectData & { workspace: NonNullable<ProjectData['workspace']> }
  }
  list(): ProjectData[] {
    const activity = new Map(
      this.projects.listProjectsSummary().map((project) => [project.id, project.lastActiveAt]),
    )
    for (const info of this.projects.listProjects()) {
      const directory = join(this.userData, 'projects', info.id, 'workspace')
      if (existsSync(directory))
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (entry.isFile() && /\.(docx|pptx|md|html|pdf)$/i.test(entry.name))
            this.projects.moveFileToProject(join(directory, entry.name), info.id)
        }
    }
    return this.projects
      .listProjects()
      .map((info) => this.projects.getProject(info.id))
      .filter((project): project is ProjectData => !!project?.workspace)
      .map((project) => {
        let editedAt = project.updatedAt
        try {
          editedAt = statSync(this.workbookPath(project.id)).mtime.toISOString()
        } catch {
          /* Missing files remain discoverable through their project metadata. */
        }
        return {
          ...project,
          updatedAt: [project.updatedAt, editedAt, activity.get(project.id) ?? ''].sort().at(-1)!,
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  private folder(id: string): string {
    this.projects.getProject(id)
    const path = join(this.userData, 'projects', id, 'workspace')
    mkdirSync(path, { recursive: true })
    return path
  }
  private save(
    id: string,
    metadata: NonNullable<ProjectData['workspace']>,
    text: string,
  ): ProjectData {
    metadata.activity = [{ at: new Date().toISOString(), text }, ...metadata.activity].slice(0, 200)
    return this.projects.updateWorkspace(id, metadata)
  }
  private source(id: string, uri: string, buffer?: Buffer, name = basename(uri)): WorkspaceSource {
    const sha256 = buffer ? digest(buffer) : undefined
    let snapshotPath: string | undefined
    if (buffer && sha256) {
      const directory = join(this.folder(id), 'sources', sha256)
      mkdirSync(directory, { recursive: true })
      snapshotPath = join(directory, name)
      if (!existsSync(snapshotPath)) writeFileSync(snapshotPath, buffer, { flag: 'wx' })
    }
    return {
      id: randomUUID(),
      name,
      uri,
      addedAt: new Date().toISOString(),
      ...(sha256 ? { sha256 } : {}),
      ...(snapshotPath ? { snapshotPath } : {}),
    }
  }
  async create(input: CreateWorkspace): Promise<ProjectData> {
    const extension = input.filePath ? extname(input.filePath).toLowerCase() : ''
    if (
      input.filePath &&
      !['.xlsx', '.csv', '.tsv', '.docx', '.pdf', '.md', '.txt'].includes(extension)
    )
      throw new Error('Unsupported starting file.')
    const original = input.filePath ? await this.boundedRead(input.filePath) : undefined
    let workbook = extension === '.xlsx' ? original : undefined
    if (original && ['.csv', '.tsv'].includes(extension)) {
      const text = decodeCsvBuffer(original)
      const delimiter =
        input.delimiter ?? (extension === '.tsv' ? '\t' : resolveImportDelimiter(text))
      const rows = parseCsv(text, delimiter)
      if (rows.reduce((count, row) => count + row.length, 0) > 100_000)
        throw new Error(
          'Project import supports up to 100,000 cells. Open larger files through Local files.',
        )
      const csv = rows
        .map((row) => row.map((value) => `"${value.replace(/"/g, '""')}"`).join(','))
        .join('\n')
      workbook = await sheetCsvToXlsxBuffer(csv)
    }
    workbook ??= await sheetCsvToXlsxBuffer('')
    const project = this.projects.createProject(input.name)
    const primaryWorkbook = join(this.folder(project.id), 'Workbook.xlsx')
    await writeXlsxAtomically(primaryWorkbook, workbook)
    this.projects.moveFileToProject(primaryWorkbook, project.id)
    const sources: WorkspaceSource[] = []
    if (original && input.filePath) sources.push(this.source(project.id, input.filePath, original))
    if (input.url)
      sources.push(this.source(project.id, input.url, undefined, new URL(input.url).hostname))
    return this.save(
      project.id,
      {
        version: 1,
        description: input.description,
        starred: false,
        primaryWorkbook,
        startKind: input.startKind ?? 'general',
        sources,
        activity: [],
      },
      'Created project',
    )
  }
  update(
    id: string,
    patch: { name?: string; description?: string; starred?: boolean },
  ): ProjectData {
    const project = this.get(id)
    if (patch.name !== undefined) this.projects.renameProject(id, patch.name)
    if (patch.description !== undefined) project.workspace.description = patch.description
    if (patch.starred !== undefined) project.workspace.starred = patch.starred
    return this.save(
      id,
      project.workspace,
      patch.name !== undefined
        ? 'Renamed project'
        : patch.starred !== undefined
          ? 'Updated project star'
          : 'Updated project description',
    )
  }
  async addSource(id: string, input: { path?: string; url?: string }): Promise<ProjectData> {
    this.get(id)
    if (!input.path && !input.url) throw new Error('Choose a file or enter a URL.')
    const bytes = input.path ? await this.boundedRead(input.path) : undefined
    const uri = input.path ?? input.url!
    const source = this.source(
      id,
      uri,
      bytes,
      input.path ? basename(input.path) : new URL(uri).hostname,
    )
    const project = this.get(id)
    if (project.workspace.sources.some((item) => item.uri === uri && item.sha256 === source.sha256))
      return project
    project.workspace.sources.push(source)
    return this.save(id, project.workspace, `Added source: ${source.name}`)
  }
  rememberWorkbook(id: string, path: string): ProjectData {
    const project = this.get(id)
    if (
      !/\.xlsx$/i.test(path) ||
      /^(?:research[\\/])?(?:previews|sources)[\\/]/i.test(relative(this.folder(id), path)) ||
      !project.files.some((file) => file.toLowerCase() === path.toLowerCase()) ||
      !existsSync(path)
    )
      throw new Error('Choose an existing project-owned workbook.')
    if (project.workspace.workingWorkbook === path) return project
    project.workspace.workingWorkbook = path
    return this.projects.updateWorkspace(id, project.workspace)
  }
  workbookPath(id: string): string {
    const project = this.get(id),
      saved = project.workspace.workingWorkbook
    return saved &&
      /\.xlsx$/i.test(saved) &&
      !/^(?:research[\\/])?(?:previews|sources)[\\/]/i.test(relative(this.folder(id), saved)) &&
      existsSync(saved) &&
      project.files.some((file) => file.toLowerCase() === saved.toLowerCase())
      ? saved
      : project.workspace.primaryWorkbook
  }
  async updateSource(id: string, sourceId: string, path: string): Promise<ProjectData> {
    const before = this.get(id).workspace.sources.find((source) => source.id === sourceId)
    if (!before?.snapshotPath) throw new Error('Choose a saved local source to update.')
    if (
      !['.xlsx', '.csv', '.tsv', '.docx', '.pdf', '.md', '.txt', '.html', '.htm'].includes(
        extname(path).toLowerCase(),
      )
    )
      throw new Error('Unsupported source file.')
    const bytes = await this.boundedRead(path),
      replacement = this.source(id, path, bytes)
    const project = this.get(id),
      index = project.workspace.sources.findIndex((source) => source.id === sourceId)
    const current = project.workspace.sources[index]
    if (!current || current.sha256 !== before.sha256)
      throw new Error('Source changed during update; inspect it again.')
    if (current.sha256 === replacement.sha256) return project
    const { id: _id, previousVersions, ...version } = current
    project.workspace.sources[index] = {
      ...replacement,
      id: sourceId,
      previousVersions: [version, ...(previousVersions ?? [])],
    }
    return this.save(
      id,
      project.workspace,
      `Updated source: ${replacement.name} · ${current.sha256?.slice(0, 8)} → ${replacement.sha256?.slice(0, 8)}; tables unchanged until reviewed refresh`,
    )
  }
  async boundedRead(path: string): Promise<Buffer> {
    if (!isAbsolute(path)) throw new Error('An absolute file path is required.')
    const { stat } = await import('node:fs/promises')
    const metadata = await stat(path)
    if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024)
      throw new Error('Choose a local file no larger than 32 MiB.')
    const bytes = await readFile(path)
    if (bytes.length > 32 * 1024 * 1024) throw new Error('File exceeds the supported size.')
    return bytes
  }
  async filePreview(
    path: string,
    delimiter?: string,
  ): Promise<{ delimiter: string | null; rows: string[][] }> {
    if (!['.csv', '.tsv'].includes(extname(path).toLowerCase()))
      return { delimiter: null, rows: [] }
    const text = decodeCsvBuffer(await this.boundedRead(path))
    const separator =
      delimiter ?? (extname(path).toLowerCase() === '.tsv' ? '\t' : resolveImportDelimiter(text))
    return {
      delimiter: separator,
      rows: parseCsv(text, separator)
        .slice(0, 6)
        .map((row) => row.slice(0, 20)),
    }
  }
  async profile(id: string, sheetId?: string, range?: string, hasHeader = true) {
    const project = this.get(id)
    return (
      await loadTable(
        await this.boundedRead(project.workspace.primaryWorkbook),
        sheetId,
        range,
        hasHeader,
      )
    ).profile
  }
  async preview(id: string, options: CleanupOptions) {
    const project = this.get(id)
    const path = project.workspace.primaryWorkbook
    const bytes = await this.boundedRead(path)
    const table = await loadTable(bytes, options.sheetId, options.range, options.hasHeader)
    const plan = planCleanup(table, options)
    for (const [token, cached] of this.previews)
      if (Date.now() - cached.created > 15 * 60_000 || cached.id === id) this.previews.delete(token)
    if (this.previews.size >= 10) throw new Error('Close another cleanup preview first.')
    this.previews.set(plan.preview.token, { id, path, plan, created: Date.now() })
    return plan.preview
  }
  discard(token: string): void {
    this.previews.delete(token)
  }
  async apply(id: string, token: string): Promise<ProjectData> {
    const preview = this.previews.get(token)
    if (!preview || preview.id !== id || Date.now() - preview.created > 15 * 60_000)
      throw new Error('Preview expired. Create a new preview.')
    if (this.busy.has(id)) throw new Error('This project is already applying changes.')
    this.busy.add(id)
    try {
      let project = this.get(id)
      if (
        project.workspace.primaryWorkbook !== preview.path ||
        digest(await this.boundedRead(preview.path)) !== preview.plan.table.sha256
      )
        throw new Error('The saved workbook changed after preview. Inspect it again.')
      const result = await buildCleanWorkbook(preview.plan)
      const path = join(this.folder(id), `Cleaned-${randomUUID().slice(0, 8)}.xlsx`)
      await writeXlsxAtomically(path, result)
      this.projects.moveFileToProject(path, id)
      const source = this.source(id, preview.path, preview.plan.table.buffer)
      project = this.get(id)
      if (!project.workspace.sources.some((item) => item.sha256 === source.sha256))
        project.workspace.sources.push(source)
      project.workspace.previousWorkbook = preview.path
      project.workspace.primaryWorkbook = path
      project.workspace.workingWorkbook = path
      const updated = this.save(
        id,
        project.workspace,
        `Cleaned table: ${preview.plan.preview.inputRows} to ${preview.plan.preview.outputRows} rows`,
      )
      this.previews.delete(token)
      return updated
    } finally {
      this.busy.delete(id)
    }
  }
  undo(id: string): ProjectData {
    if (this.busy.has(id)) throw new Error('Wait for cleanup to finish.')
    const project = this.get(id)
    if (!project.workspace.previousWorkbook) throw new Error('No cleanup to undo.')
    const current = project.workspace.primaryWorkbook
    project.workspace.primaryWorkbook = project.workspace.previousWorkbook
    project.workspace.workingWorkbook = project.workspace.primaryWorkbook
    project.workspace.previousWorkbook = current
    return this.save(id, project.workspace, 'Switched to the previous workbook version')
  }
  async sourcePreviewPath(id: string, sourceId: string, version?: string): Promise<string> {
    const current = this.get(id).workspace.sources.find((item) => item.id === sourceId)
    const source =
      version && version !== current?.sha256
        ? current?.previousVersions?.find((source) => source.sha256 === version)
        : current
    if (!source) throw new Error('Source not found.')
    if (!source.snapshotPath) return source.uri
    if (digest(await this.boundedRead(source.snapshotPath)) !== source.sha256)
      throw new Error('Source snapshot changed; its evidence is unavailable.')
    const directory = join(this.folder(id), 'previews', randomUUID())
    mkdirSync(directory, { recursive: true })
    const path = join(directory, source.name)
    await copyFile(source.snapshotPath, path)
    this.projects.moveFileToProject(path, id)
    return path
  }
}
