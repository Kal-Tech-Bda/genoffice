import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { z } from 'zod'
import { RESEARCH_CHANNEL, EVIDENCE_CHANNEL, type ResearchConfig } from '../../shared/research-api'
import { WorkspaceStore } from '../workspace-store'
import { ResearchService } from './service'
import { quoteColumns } from './extract'
import { datasetPage } from './pages'
import { ENGINEERING_POLICY } from './engineering-policy'
import { JOB_SITES } from '../../shared/jobs-api'

const projectId = z.string().regex(/^proj-[a-f0-9]{12}$/)
const uuid = z.string().uuid()
const value = z.union([z.string().max(2000), z.number().finite(), z.null()])
const key = z.string().regex(/^[a-zA-Z0-9_ -]{1,50}$/)
const offset = z.number().int().min(0).max(1_000_000).default(0)
const page = z
  .object({
    tableId: key.optional(),
    offset: offset.optional(),
    needsReview: z.boolean().optional(),
  })
  .strict()
  .optional()
const config = z
  .object({
    kind: z.enum(['quotes', 'worldbank', 'enrich', 'jobs']),
    instructions: z.string().max(4000),
    sourceIds: z.array(uuid).max(20),
    fields: z.array(z.enum(quoteColumns.map((c) => c.id) as [string, ...string[]])).max(6),
    countries: z.array(z.string().regex(/^[A-Z]{3}$/)).max(10),
    fromYear: z.number().int().min(1960).max(new Date().getFullYear()),
    toYear: z.number().int().min(1960).max(new Date().getFullYear()),
    parentWorkflowId: uuid.optional(),
    jobSiteIds: z
      .array(z.enum(JOB_SITES.map((s) => s.id) as ['bma', 'coralisle', 'expertise']))
      .max(3)
      .optional(),
  })
  .strict()
  .refine((c) => c.toYear >= c.fromYear && c.toYear - c.fromYear <= 2, 'Choose at most three years')
  .refine(
    (c) => c.kind === 'jobs' || c.fields.includes('quote_id'),
    'Quote ID is required for stable keys',
  )
  .refine(
    (c) =>
      [c.sourceIds, c.fields, c.countries].every(
        (values) => new Set(values).size === values.length,
      ),
    'Remove duplicate input IDs, fields or country codes',
  )
const evidence = z
  .object({
    sourceId: z.string().max(100),
    sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
    sourceName: z.string().max(255),
    uri: z.string().max(4096),
    retrievedAt: z.string().max(40),
    locator: z.string().max(200),
    excerpt: z.string().max(200_000),
    method: z.string().max(100),
  })
  .strict()
const selection = z
  .object({ tableId: key, rowId: z.string().regex(/^[a-f0-9]{24}$/), columnId: key, value })
  .strict()

export function registerResearchIpc(
  host: () => BrowserWindow | null,
  open: (path: string) => void,
  sheetPath: (id: number) => string | null,
): ResearchService {
  const service = new ResearchService(
    app.getPath('userData'),
    new WorkspaceStore(app.getPath('userData')),
  )
  service.start()
  app.on('before-quit', () => service.close())
  ipcMain.handle(RESEARCH_CHANNEL, async (event, method: unknown, ...args: unknown[]) => {
    const window = host()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Research operations require the application shell.')
    const id = projectId.parse(args[0])
    service.workspace.get(id)
    switch (method) {
      case 'readiness':
        return service.readiness(id, uuid.parse(args[1]))
      case 'overview':
        return service.overview(id)
      case 'policy':
        return ENGINEERING_POLICY
      case 'state':
        return service.state(id, offset.parse(args[1]), uuid.optional().parse(args[2]))
      case 'detail':
        return service.detail(id, uuid.parse(args[1]), page.parse(args[2]))
      case 'cell':
        return service.cell(
          id,
          uuid.parse(args[1]),
          uuid.nullable().parse(args[2]),
          key.parse(args[3]),
          z
            .string()
            .regex(/^[a-f0-9]{24}$/)
            .parse(args[4]),
          key.parse(args[5]),
        )
      case 'absent':
        return service.absent(id, uuid.parse(args[1]), offset.parse(args[2]))
      case 'save':
        return service.save(
          id,
          z.string().trim().min(1).max(120).parse(args[1]),
          config.parse(args[2]) as ResearchConfig,
          uuid.optional().parse(args[3]),
        )
      case 'run': {
        const workflowId = uuid.parse(args[1]),
          sample = z.boolean().parse(args[2])
        if (!sample && service.store.workflow(workflowId, id).config.kind === 'quotes') {
          const check = await service.readiness(id, workflowId)
          if (!check.readyToRun)
            throw new Error(
              'Input readiness blocks this full run. Fix or exclude blocked inputs, save the configuration, then check again.',
            )
        }
        const run = service.run(id, workflowId, sample)
        return service.store.summary(run.id, id)
      }
      case 'cancel':
        return service.cancel(id, uuid.parse(args[1]))
      case 'retry': {
        const run = service.retry(id, uuid.parse(args[1]))
        return service.store.summary(run.id, id)
      }
      case 'publish':
        return service.publish(
          id,
          uuid.parse(args[1]),
          z.boolean().parse(args[2]),
          z.boolean().parse(args[3]),
        )
      case 'schedule': {
        const w = service.store.workflow(uuid.parse(args[1]), id)
        service.store.schedule(
          w.id,
          z.union([z.number().int().min(15).max(10080), z.null()]).parse(args[2]),
          z.boolean().parse(args[3]),
        )
        return
      }
      case 'copy': {
        const w = service.store.workflow(uuid.parse(args[1]), id)
        return service.store.save(id, `${w.name} template`, {
          ...w.config,
          sourceIds: [],
          countries: [],
          parentWorkflowId: undefined,
          jobSiteIds: [],
        })
      }
      case 'accepted': {
        const w = service.store.workflow(uuid.parse(args[1]), id)
        return datasetPage(service.store.accepted(w.id), page.parse(args[2]))
      }
      case 'createFrom':
        return service.createFrom(
          id,
          uuid.parse(args[1]),
          z.string().trim().min(1).max(120).parse(args[2]),
          z.string().max(4000).parse(args[3]),
        )
      case 'correct':
        return service.correct(
          id,
          uuid.parse(args[1]),
          key.parse(args[2]),
          z
            .string()
            .regex(/^[a-f0-9]{24}$/)
            .parse(args[3]),
          key.parse(args[4]),
          value.parse(args[5]),
          z.string().trim().min(1).max(2000).parse(args[6]),
        )
      case 'open': {
        const w = service.store.workflow(uuid.parse(args[1]), id)
        if (!w.destination) throw new Error('Publish a full reviewed candidate first.')
        service.workspace.projects.moveFileToProject(w.destination, id)
        open(w.destination)
        return
      }
      case 'visitJob':
        return shell.openExternal(
          service.jobListingUrl(
            id,
            uuid.parse(args[1]),
            uuid.nullable().parse(args[2]),
            z
              .string()
              .regex(/^[a-f0-9]{24}$/)
              .parse(args[3]),
          ),
        )
      case 'evidence':
        return service.evidence(id, evidence.parse(args[1]))
      case 'openEvidence':
        open(await service.evidencePath(id, evidence.parse(args[1])))
        return
      default:
        throw new Error('Unknown research action.')
    }
  })
  ipcMain.handle(EVIDENCE_CHANNEL, async (event, method: unknown, ...args: unknown[]) => {
    const path = sheetPath(event.sender.id)
    if (!path || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Evidence access requires an owned Sheets tab.')
    if (method === 'cell') return service.sheetCell(path, selection.parse(args[0]))
    if (method === 'inspect' || method === 'open') {
      const target = z
        .object({
          workflowId: uuid,
          tableId: key,
          rowId: z.string().regex(/^[a-f0-9]{24}$/),
          columnId: key,
        })
        .passthrough()
        .parse(args[0])
      const details = await service.sheetCell(path, {
        tableId: target.tableId,
        rowId: target.rowId,
        columnId: target.columnId,
        value: null,
      })
      if (!details || details.workflowId !== target.workflowId)
        throw new Error('Evidence cell does not belong to this workbook.')
      const index = z.number().int().min(0).max(100).parse(args[1])
      const item = details.cell.evidence[index]
      if (!item) throw new Error('Evidence reference not found.')
      const w = service.store.workflow(details.workflowId)
      if (method === 'inspect') return service.evidence(w.projectId, item)
      open(await service.evidencePath(w.projectId, item))
      return
    }
    throw new Error('Unknown evidence action.')
  })
  return service
}
