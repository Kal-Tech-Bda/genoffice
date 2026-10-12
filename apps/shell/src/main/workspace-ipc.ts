import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFile } from 'node:fs/promises'
import { z } from 'zod'
import { WORKSPACE_CHANNEL } from '../shared/workspace-api'
import { WorkspaceStore } from './workspace-store'
import { exportTarget, workspaceExportProtectedPaths } from './export-target'
import type { ResearchProjectSummary } from '../shared/research-api'
import type { WorkspaceProject } from '../shared/workspace-api'

const id = z.string().regex(/^proj-[a-f0-9]{12}$/)
const path = z.string().min(1).max(4096)
const url = z
  .string()
  .max(4096)
  .url()
  .refine(
    (value) =>
      ['http:', 'https:'].includes(new URL(value).protocol) &&
      !new URL(value).username &&
      !new URL(value).password,
  )
const delimiter = z.enum([',', ';', '\t', '|'])
const options = z
  .object({
    sheetId: z.string().max(200),
    range: z.string().max(32),
    hasHeader: z.boolean(),
    trim: z.boolean(),
    removeBlankRows: z.boolean(),
    keys: z.array(z.number().int().min(0).max(16_382)).max(100),
    deduplicate: z.boolean(),
    sortColumn: z.number().int().min(0).max(16_382).nullable(),
    descending: z.boolean(),
    renames: z.record(z.string().regex(/^\d+$/), z.string().trim().min(1).max(255)),
    formats: z.record(
      z.string().regex(/^\d+$/),
      z.enum(['number', 'date-iso', 'date-us', 'date-uk']),
    ),
  })
  .strict()

export function registerWorkspaceIpc(
  host: () => BrowserWindow | null,
  open: (path: string) => void,
  layout: (left: number, top: number) => void,
  summaries: (projects: WorkspaceProject[]) => Record<string, ResearchProjectSummary>,
): void {
  const store = new WorkspaceStore(app.getPath('userData'))
  ipcMain.handle(WORKSPACE_CHANNEL, async (event, method: unknown, ...args: unknown[]) => {
    const window = host()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Workspace access is limited to the application shell.')
    switch (method) {
      case 'list': {
        const projects = store.list(),
          research = summaries(projects)
        return projects.map((project) => ({ ...project, research: research[project.id] }))
      }
      case 'create':
        return store.create(
          z
            .object({
              name: z.string().trim().min(1).max(120),
              description: z.string().max(4000),
              filePath: path.optional(),
              url: url.optional(),
              delimiter: delimiter.optional(),
              startKind: z
                .enum(['general', 'extractFiles', 'researchWeb', 'workSpreadsheet'])
                .optional(),
            })
            .strict()
            .parse(args[0]),
        )
      case 'update':
        return store.update(
          id.parse(args[0]),
          z
            .object({
              name: z.string().trim().min(1).max(120).optional(),
              description: z.string().max(4000).optional(),
              starred: z.boolean().optional(),
            })
            .strict()
            .parse(args[1]),
        )
      case 'open':
        open(store.workbookPath(id.parse(args[0])))
        return
      case 'rememberWorkbook':
        return store.rememberWorkbook(id.parse(args[0]), path.parse(args[1]))
      case 'pickFile': {
        const result = await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [
            {
              name: 'Research files',
              extensions: ['xlsx', 'csv', 'tsv', 'docx', 'pdf', 'md', 'txt', 'html', 'htm'],
            },
          ],
        })
        return result.canceled ? null : (result.filePaths[0] ?? null)
      }
      case 'filePreview':
        return store.filePreview(path.parse(args[0]), delimiter.optional().parse(args[1]))
      case 'addSource':
        return store.addSource(
          id.parse(args[0]),
          z.object({ path: path.optional(), url: url.optional() }).strict().parse(args[1]),
        )
      case 'updateSource':
        return store.updateSource(
          id.parse(args[0]),
          z.string().uuid().parse(args[1]),
          path.parse(args[2]),
        )
      case 'openSource': {
        const target = await store.sourcePreviewPath(
          id.parse(args[0]),
          z.string().uuid().parse(args[1]),
          z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional()
            .parse(args[2]),
        )
        if (/^https?:\/\//i.test(target)) await shell.openExternal(url.parse(target))
        else open(target)
        return
      }
      case 'layout':
        layout(
          z.union([z.literal(0), z.literal(224)]).parse(args[0]),
          z.union([z.literal(0), z.literal(56)]).parse(args[1]),
        )
        return
      case 'profile':
        return store.profile(
          id.parse(args[0]),
          z.string().max(200).optional().parse(args[1]),
          z.string().max(32).optional().parse(args[2]),
          z.boolean().optional().parse(args[3]),
        )
      case 'preview':
        return store.preview(id.parse(args[0]), options.parse(args[1]))
      case 'discard':
        store.discard(z.string().uuid().parse(args[0]))
        return
      case 'apply':
        return store.apply(id.parse(args[0]), z.string().uuid().parse(args[1]))
      case 'undoCleanup':
        return store.undo(id.parse(args[0]))
      case 'exportWorkbook': {
        const project = store.get(id.parse(args[0]))
        const ownedPath = path.optional().parse(args[1])
        if (
          ownedPath &&
          (!/\.xlsx$/i.test(ownedPath) ||
            !project.files.some((file) => file.toLowerCase() === ownedPath.toLowerCase()))
        )
          throw new Error('Export requires a project-owned workbook.')
        const result = await dialog.showSaveDialog(window, {
          defaultPath: `${project.name.replace(/[<>:"/\\|?*]/g, '-')}.xlsx`,
          filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }],
        })
        if (!result.canceled && result.filePath) {
          const target = await exportTarget(
            result.filePath,
            app.getPath('userData'),
            workspaceExportProtectedPaths(store),
          )
          await copyFile(ownedPath ?? store.workbookPath(project.id), target)
          return true
        }
        return false
      }
      default:
        throw new Error('Unknown workspace action.')
    }
  })
}
