import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import JSZip from 'jszip'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'
import { RESEARCH_CHANNEL, type ResearchDataset } from '../apps/shell/src/shared/research-api'
import type { WorkspaceProject } from '../apps/shell/src/shared/workspace-api'

const artifacts = resolve(__dirname, '../docs/testing/output-ux-2026-10-12')
const fixture = resolve(__dirname, '../fixtures/infomonk/research/valid.txt')

function record(name: string, value: unknown) {
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(join(artifacts, name), JSON.stringify(value, null, 2) + '\n')
}
async function capture(app: ElectronApplication, name: string) {
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1800, height: 1200 },
    })
    const source = sources.find((source) => source.id === window.getMediaSourceId())
    if (!source) throw new Error('Native output capture unavailable.')
    return source.thumbnail.toPNG().toString('base64')
  })
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(join(artifacts, `${name}.png`), Buffer.from(png, 'base64'))
}
async function publish(page: Page, projectId: string, workflowId: string) {
  const run = await page.evaluate(
    ([projectId, workflowId]) => window.infomonkResearch.run(projectId, workflowId, false),
    [projectId, workflowId],
  )
  await expect
    .poll(() =>
      page.evaluate(
        async ({ projectId, runId }) =>
          (await window.infomonkResearch.state(projectId)).runs.find((run) => run.id === runId)
            ?.status,
        { projectId, runId: run.id },
      ),
    )
    .toBe('review')
  await page.evaluate(
    ([projectId, runId]) => window.infomonkResearch.publish(projectId, runId, true, false),
    [projectId, run.id],
  )
}
async function acceptedProject(page: Page, name: string, tableName: string) {
  const project = await page.evaluate(
    ({ name, filePath }) =>
      window.infomonk.create({
        name,
        description: 'Synthetic local supplier quotes for the returning-user output journey.',
        filePath,
        startKind: 'extractFiles',
      }),
    { name, filePath: fixture },
  )
  const workflow = await page.evaluate(
    ({ project, name }) =>
      window.infomonkResearch.save(project.id, name, {
        kind: 'quotes',
        instructions: 'Extract the labeled supplier quote from the confirmed local TXT snapshot.',
        sourceIds: project.workspace!.sources.map((source) => source.id),
        fields: ['quote_id', 'supplier', 'date', 'currency', 'total', 'country_code'],
        countries: [],
        fromYear: 2026,
        toYear: 2026,
      }),
    { project, name: tableName },
  )
  await publish(page, project.id, workflow.id)
  return { project, workflow }
}
async function outputs(page: Page, project: WorkspaceProject) {
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page
    .getByRole('button', { name: `Open last working workbook: ${project.name}`, exact: true })
    .click()
  await page.getByRole('button', { name: 'Outputs', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Outputs', exact: true })).toBeVisible()
}
async function saveDialog(app: ElectronApplication, path: string | null) {
  await app.evaluate(({ dialog }, path) => {
    const fixture = { calls: 0 }
    ;(globalThis as unknown as { __outputDialogFixture: typeof fixture }).__outputDialogFixture =
      fixture
    dialog.showSaveDialog = (async () => {
      fixture.calls++
      return { canceled: path === null, filePath: path ?? undefined }
    }) as typeof dialog.showSaveDialog
  }, path)
}
async function dialogCalls(app: ElectronApplication) {
  return app.evaluate(
    () =>
      (globalThis as unknown as { __outputDialogFixture: { calls: number } }).__outputDialogFixture
        .calls,
  )
}
async function exportedQuote(path: string) {
  const zip = await JSZip.loadAsync(readFileSync(path))
  const metadata = JSON.parse(await zip.file('infomonk/research.json')!.async('string')) as {
    version: number
    workflowId: string
    revision: number
    dataset: ResearchDataset
  }
  const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
  const cell = /<c\b[^>]*\br="E2"[^>]*>([\s\S]*?)<\/c>/.exec(xml)?.[1]
  const gridTotal = Number(/<v>([^<]+)<\/v>/.exec(cell ?? '')?.[1])
  const table = metadata.dataset.tables.find((table) => table.id === 'quotes')!
  return { metadata, gridTotal, total: table.rows[0].cells.total }
}
async function editCell(sheet: Page, address: string, value: string) {
  await expect(sheet.locator('main[inert]')).toHaveCount(0)
  const name = sheet.locator('[data-u-comp="defined-name"] input')
  await name.fill(address)
  await name.press('Enter')
  await expect
    .poll(() =>
      sheet.evaluate(
        () =>
          (
            window as unknown as { __genofficeDebug: { focusContext(): { activeUComp: string } } }
          ).__genofficeDebug.focusContext().activeUComp,
      ),
    )
    .toBe('editor')
  await sheet.keyboard.type(value)
  await sheet.keyboard.press('Enter')
}
async function menuSave(app: ElectronApplication) {
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const menu = Menu.getApplicationMenu()
      ?.items.find((item) => item.label === 'File')
      ?.submenu?.items.find((item) => item.label === 'Save')
    if (!menu || !menu.enabled)
      throw new Error('The active native File > Save command is unavailable.')
    menu.click(undefined as never, BrowserWindow.getFocusedWindow()!, undefined as never)
  })
}

test('a returning analyst exports ledger revisions, saves native edits separately and recognizes the last working workbook', async () => {
  test.setTimeout(150_000)
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'output-ledger-journey',
    env: { GENOFFICE_DEBUG_HOOKS: '1' },
  })
  const { app, page } = launched
  const errors: string[] = []
  const watch = (page: Page) => page.on('pageerror', (error) => errors.push(String(error)))
  app.windows().forEach(watch)
  app.on('window', watch)
  const directory = mkdtempSync(join(tmpdir(), 'infomonk-output-journey-'))
  try {
    const { project, workflow } = await acceptedProject(
      page,
      'Supplier output journey',
      'Supplier quote ledger',
    )
    const revised = join(directory, 'supplier-revised.txt')
    writeFileSync(
      revised,
      readFileSync(fixture, 'utf8')
        .replace('Total: 125.50', 'Total: 133.50')
        .replace('Item 2 | Delivery | 1 | 25.50', 'Item 2 | Delivery | 1 | 33.50'),
    )
    await page.evaluate(
      ({ projectId, sourceId, path }) => window.infomonk.updateSource(projectId, sourceId, path),
      { projectId: project.id, sourceId: project.workspace!.sources[0].id, path: revised },
    )
    await publish(page, project.id, workflow.id)
    await page.reload()
    await outputs(page, project)
    await expect(
      page.getByRole('heading', { name: 'Accepted revisions · 2', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText('Source snapshots remain in this workspace.', { exact: false }),
    ).toBeVisible()
    const revisions = await page.evaluate((id) => window.infomonkResearch.overview(id), project.id)
    const older = revisions.outputs.find((output) => output.revision === 1)!
    const current = revisions.outputs.find((output) => output.revision === 2)!
    const exportButton = (revision: number) =>
      page.getByRole('button', {
        name: `Export accepted data: ${workflow.name} revision ${revision}`,
        exact: true,
      })
    const exports: { revision: number; gridTotal: number; ledgerTotal: unknown }[] = []
    for (const [revision, expected, snapshot] of [
      [1, 125.5, fixture],
      [2, 133.5, revised],
    ] as const) {
      const target = join(directory, `accepted-r${revision}.xlsx`)
      await saveDialog(app, target)
      await exportButton(revision).click()
      await expect(page.getByRole('status')).toHaveText(
        `${workflow.name} revision ${revision} exported from accepted data.`,
      )
      expect(await dialogCalls(app)).toBe(1)
      const result = await exportedQuote(target)
      expect(result.metadata.version).toBe(1)
      expect(result.metadata.workflowId).toBe(workflow.id)
      expect(result.metadata.revision).toBe(revision)
      expect(result.gridTotal).toBe(expected)
      expect(result.total.value).toBe(expected)
      expect(result.total.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceVersion: createHash('sha256').update(readFileSync(snapshot)).digest('hex'),
            locator: 'Text line 6',
          }),
        ]),
      )
      exports.push({ revision, gridTotal: result.gridTotal, ledgerTotal: result.total.value })
    }
    await saveDialog(app, null)
    await exportButton(2).click()
    await expect.poll(() => dialogCalls(app)).toBe(1)
    await expect(exportButton(2)).toBeEnabled()
    await expect(page.getByRole('status')).toHaveCount(0)
    const managedBytes = readFileSync(current.path)
    await saveDialog(app, current.path)
    await exportButton(2).click()
    await expect(page.getByRole('alert')).toContainText('Export outside the managed workspace')
    await expect(exportButton(2)).toBeEnabled()
    expect(readFileSync(current.path).equals(managedBytes)).toBe(true)
    await expect(page.getByRole('status')).toHaveCount(0)
    const recoveredTarget = join(directory, 'accepted-after-protected-target.xlsx')
    await saveDialog(app, recoveredTarget)
    await exportButton(2).click()
    await expect(page.getByRole('status')).toHaveText(
      `${workflow.name} revision 2 exported from accepted data.`,
    )
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect((await exportedQuote(recoveredTarget)).gridTotal).toBe(133.5)
    await saveDialog(app, null)
    await exportButton(2).click()
    await expect(exportButton(2)).toBeEnabled()
    await expect(page.getByRole('status')).toHaveCount(0)

    for (const width of [900, 1450]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setContentSize(width, 900)
      }, width)
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((theme) => window.aiOffice.setTheme(theme), theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        const dimensions = await page.locator('.im-main').evaluate((element) => ({
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }))
        expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
        await expect(exportButton(2)).toBeInViewport()
        await capture(app, `outputs-${width}-${theme}`)
      }
    }

    await page
      .getByRole('button', { name: `Open ${workflow.name} revision 2`, exact: true })
      .click()
    const sheet = await waitForPageWithUrl(app, '://sheets/')
    await editCell(sheet, 'E2', '999')
    await menuSave(app)
    await expect.poll(async () => (await exportedQuote(current.path)).gridTotal).toBe(999)
    expect((await exportedQuote(current.path)).total.value).toBe(133.5)
    const nativeTarget = join(directory, 'saved-native-workbook.xlsx')
    await saveDialog(app, nativeTarget)
    await page.getByRole('button', { name: 'Export workbook', exact: true }).click()
    await expect
      .poll(
        () =>
          existsSync(nativeTarget) && readFileSync(nativeTarget).equals(readFileSync(current.path)),
      )
      .toBe(true)
    expect((await exportedQuote(nativeTarget)).gridTotal).toBe(999)
    await page.getByRole('button', { name: 'Outputs', exact: true }).click()
    const ledgerTarget = join(directory, 'ledger-after-native-save.xlsx')
    await saveDialog(app, ledgerTarget)
    await exportButton(2).click()
    await expect(page.getByRole('status')).toHaveText(
      `${workflow.name} revision 2 exported from accepted data.`,
    )
    const ledgerAfterSave = await exportedQuote(ledgerTarget)
    expect(ledgerAfterSave.gridTotal).toBe(133.5)
    expect(ledgerAfterSave.total.value).toBe(133.5)
    expect((await exportedQuote(current.path)).gridTotal).toBe(999)
    expect(
      (await page.evaluate(
        ([projectId, workflowId]) => window.infomonkResearch.accepted(projectId, workflowId),
        [project.id, workflow.id],
      ))!.tables.find((table) => table.id === 'quotes')!.rows[0].cells.total.value,
    ).toBe(133.5)

    await page
      .getByRole('button', { name: `Open ${workflow.name} revision 1`, exact: true })
      .click()
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.infomonk.list()).find((project) => project.id === id)?.workspace
              ?.workingWorkbook,
          project.id,
        ),
      )
      .toBe(older.path)
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    const opener = page.getByRole('button', {
      name: `Open last working workbook: ${project.name}`,
      exact: true,
    })
    await expect(opener).toContainText(basename(older.path))
    await expect(page.getByRole('status')).toHaveCount(0)
    await capture(app, 'home-remembered-earlier-workbook-dark')
    expect(errors).toEqual([])
    record('ledger-journey-results.json', {
      checkedAt: new Date().toISOString(),
      passed: true,
      synthetic: true,
      actualLocalTxtExtractionAndPublication: true,
      nativeMenuSave: true,
      exports,
      nativeSavedGridTotal: 999,
      separateNativeWorkbookExportGridTotal: 999,
      acceptedExportAfterNativeSave: ledgerAfterSave.gridTotal,
      protectedManagedProjectionBytesPreserved: true,
      exportErrorClearedBySuccessfulRetry: true,
      earlierWorkbookRemembered: true,
      nativeLayouts: [900, 1450].flatMap((width) =>
        ['light', 'dark'].map((theme) => ({ width, theme })),
      ),
      rendererErrors: errors,
      limits: [
        'No network collection or provider calls.',
        'Evidence metadata is exported; source snapshot bytes remain in the workspace.',
      ],
    })
  } finally {
    await closeAndSaveVideo(launched, 'output-ledger-journey')
  }
})

/** Intercept only completed real overview responses in the isolated app. */
async function installOverviewDelay(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }, channel) => {
    const original = (
      ipcMain as unknown as {
        _invokeHandlers: Map<
          string,
          (event: unknown, method: string, ...args: unknown[]) => unknown
        >
      }
    )._invokeHandlers.get(channel)
    if (!original) throw new Error('Research IPC handler is not registered.')
    const fixture = {
      next: new Set<string>(),
      pending: [] as {
        projectId: string
        value: unknown
        resolve: (value: unknown) => void
        reject: (error: Error) => void
      }[],
    }
    ;(
      globalThis as unknown as { __outputOverviewFixture: typeof fixture }
    ).__outputOverviewFixture = fixture
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, method: string, ...args: unknown[]) => {
      const projectId = String(args[0])
      const delayed = method === 'overview' && fixture.next.delete(projectId)
      const value = await original(event, method, ...args)
      if (!delayed) return value
      return new Promise((resolve, reject) =>
        fixture.pending.push({ projectId, value, resolve, reject }),
      )
    })
  }, RESEARCH_CHANNEL)
}
async function armOverview(app: ElectronApplication, projectId: string) {
  await app.evaluate((_electron, id) => {
    ;(
      globalThis as unknown as { __outputOverviewFixture: { next: Set<string> } }
    ).__outputOverviewFixture.next.add(id)
  }, projectId)
}
async function releaseOverview(app: ElectronApplication, projectId: string, fail = false) {
  await expect
    .poll(() =>
      app.evaluate(
        (_electron, id) =>
          (
            globalThis as unknown as {
              __outputOverviewFixture: { pending: { projectId: string }[] }
            }
          ).__outputOverviewFixture.pending.some((response) => response.projectId === id),
        projectId,
      ),
    )
    .toBe(true)
  await app.evaluate(
    (_electron, { projectId, fail }) => {
      const fixture = (
        globalThis as unknown as {
          __outputOverviewFixture: {
            pending: {
              projectId: string
              value: unknown
              resolve: (value: unknown) => void
              reject: (error: Error) => void
            }[]
          }
        }
      ).__outputOverviewFixture
      const index = fixture.pending.findIndex((response) => response.projectId === projectId)
      const [response] = fixture.pending.splice(index, 1)
      if (!response) throw new Error('Delayed project overview is unavailable.')
      if (fail) response.reject(new Error('Synthetic project overview read failed.'))
      else response.resolve(response.value)
    },
    { projectId, fail },
  )
}

test('a returning researcher never sees another project’s outputs during delayed, failed or retried loading', async () => {
  test.setTimeout(120_000)
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'output-overview-races' })
  const { app, page } = launched
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    const first = await acceptedProject(page, 'First supplier project', 'First supplier table')
    const second = await acceptedProject(page, 'Second supplier project', 'Second supplier table')
    const empty = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Empty output project',
        description: 'No accepted ledger revisions yet.',
      }),
    )
    await page.reload()
    await installOverviewDelay(app)
    const table = (name: string) =>
      page.getByRole('button', { name: `Export accepted data: ${name} revision 1`, exact: true })
    await outputs(page, first.project)
    await expect(table(first.workflow.name)).toBeVisible()
    await armOverview(app, second.project.id)
    await outputs(page, second.project)
    await expect(page.getByRole('status')).toHaveText('Loading accepted revisions…')
    await expect(table(first.workflow.name)).toHaveCount(0)
    await expect(table(second.workflow.name)).toHaveCount(0)
    await releaseOverview(app, second.project.id, true)
    await expect(page.getByRole('alert')).toContainText('Synthetic project overview read failed')
    await expect(
      page.getByText('Accepted revisions could not load.', { exact: false }),
    ).toBeVisible()
    await expect(table(first.workflow.name)).toHaveCount(0)
    await expect(table(second.workflow.name)).toHaveCount(0)
    await capture(app, 'outputs-current-overview-failure')
    await page.getByRole('button', { name: 'Outputs', exact: true }).click()
    await expect(table(second.workflow.name)).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)

    await armOverview(app, first.project.id)
    await outputs(page, first.project)
    await expect(page.getByRole('status')).toHaveText('Loading accepted revisions…')
    await expect(table(second.workflow.name)).toHaveCount(0)
    await outputs(page, second.project)
    await expect(table(second.workflow.name)).toBeVisible()
    await releaseOverview(app, first.project.id)
    await expect(table(second.workflow.name)).toBeVisible()
    await expect(table(first.workflow.name)).toHaveCount(0)

    await armOverview(app, second.project.id)
    await page.getByRole('button', { name: 'Outputs', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Loading accepted revisions…')
    await outputs(page, first.project)
    await expect(table(first.workflow.name)).toBeVisible()
    await releaseOverview(app, second.project.id, true)
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(table(first.workflow.name)).toBeVisible()
    await expect(table(second.workflow.name)).toHaveCount(0)

    await outputs(page, empty)
    await expect(
      page.getByRole('heading', { name: 'Accepted revisions · 0', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('No accepted revisions yet.', { exact: false })).toBeVisible()
    await expect(table(first.workflow.name)).toHaveCount(0)
    await expect(table(second.workflow.name)).toHaveCount(0)
    await capture(app, 'outputs-empty-accepted-state')
    expect(existsSync(fixture)).toBe(true)
    expect(errors).toEqual([])
    record('overview-journey-results.json', {
      checkedAt: new Date().toISOString(),
      passed: true,
      synthetic: true,
      actualLocalExtractionAndPublication: true,
      responseDelayAndFailureOnly: true,
      checks: [
        'Project transition clears previous outputs while loading.',
        'Current request failure retains an alert and no stale rows.',
        'Same-section retry loads the selected project and clears the alert.',
        'Late success and late failure from departed projects cannot replace current results or show errors.',
        'A successful empty overview distinguishes no accepted revisions from a failed read.',
      ],
      rendererErrors: errors,
    })
  } finally {
    await closeAndSaveVideo(launched, 'output-overview-races')
  }
})
