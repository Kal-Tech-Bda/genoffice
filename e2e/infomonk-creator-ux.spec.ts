import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo } from './helpers'
import { WORKSPACE_CHANNEL } from '../apps/shell/src/shared/workspace-api'

async function choose(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, path)
}

/** Delay only a completed real local preview response in this isolated application. */
async function installPreviewDelay(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }, channel) => {
    const original = (
      ipcMain as unknown as {
        _invokeHandlers: Map<
          string,
          (event: unknown, method: string, ...args: unknown[]) => unknown
        >
      }
    )._invokeHandlers.get(channel)
    if (!original) throw new Error('Workspace IPC handler is not registered.')
    const fixture = {
      next: false,
      pending: [] as {
        value: unknown
        resolve: (value: unknown) => void
        reject: (error: Error) => void
      }[],
    }
    ;(
      globalThis as unknown as { __creatorPreviewFixture: typeof fixture }
    ).__creatorPreviewFixture = fixture
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, method: string, ...args: unknown[]) => {
      const delayed = method === 'filePreview' && fixture.next
      if (delayed) fixture.next = false
      const value = await original(event, method, ...args)
      if (!delayed) return value
      return new Promise((resolve, reject) => fixture.pending.push({ value, resolve, reject }))
    })
  }, WORKSPACE_CHANNEL)
}
async function armPreview(app: ElectronApplication) {
  await app.evaluate(() => {
    ;(
      globalThis as unknown as { __creatorPreviewFixture: { next: boolean } }
    ).__creatorPreviewFixture.next = true
  })
}
async function releasePreview(app: ElectronApplication, fail = false) {
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as unknown as { __creatorPreviewFixture: { pending: unknown[] } })
            .__creatorPreviewFixture.pending.length,
      ),
    )
    .toBe(1)
  await app.evaluate((_electron, fail) => {
    const response = (
      globalThis as unknown as {
        __creatorPreviewFixture: {
          pending: {
            value: unknown
            resolve: (value: unknown) => void
            reject: (error: Error) => void
          }[]
        }
      }
    ).__creatorPreviewFixture.pending.shift()!
    if (fail) response.reject(new Error('Synthetic selected-file preview failed.'))
    else response.resolve(response.value)
  }, fail)
}
async function resize(app: ElectronApplication, page: Page, width: number) {
  await app.evaluate(({ BrowserWindow }, width) => {
    BrowserWindow.getAllWindows()[0].setContentSize(width, 850)
  }, width)
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(width)
}
async function capture(app: ElectronApplication, directory: string, name: string) {
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1800, height: 1200 },
    })
    const source = sources.find((source) => source.id === window.getMediaSourceId())
    if (!source) throw new Error('Native workspace screenshot unavailable.')
    return source.thumbnail.toPNG().toString('base64')
  })
  writeFileSync(join(directory, `${name}.png`), Buffer.from(png, 'base64'))
}
async function withinMain(page: Page) {
  const dimensions = await page.locator('.im-main').evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    right: element.getBoundingClientRect().right,
    viewport: window.innerWidth,
  }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
  expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport + 1)
}

test('creator previews and keyboard focus stay current; project navigation and outputs fit both widths and themes', async () => {
  test.setTimeout(150_000)
  const artifacts = resolve(__dirname, 'artifacts', 'creator-workspace-ux')
  mkdirSync(artifacts, { recursive: true })
  const directory = mkdtempSync(join(artifacts, 'fixtures-'))
  const first = join(directory, 'first.tsv')
  const second = join(directory, 'second.csv')
  const source = join(
    directory,
    'supplier-quote-with-a-long-descriptive-file-name-for-width-checks.txt',
  )
  writeFileSync(first, 'ID\tDescription\n001\tOLD PREVIEW ROW\n')
  writeFileSync(
    second,
    'ID,Description\n' +
      Array.from({ length: 6 }, (_, i) => `NEW-${i},NEW PREVIEW ROW ${i}`).join('\n'),
  )
  writeFileSync(source, readFileSync(resolve(__dirname, '../fixtures/infomonk/research/valid.txt')))
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'creator-workspace-ux' })
  const { app, page } = launched
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    await resize(app, page, 900)
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    const trigger = page.getByRole('button', { name: 'Extract from files', exact: true })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: 'New project', exact: true })
    await expect(dialog.getByLabel('Project name', { exact: true })).toBeFocused()
    await dialog.getByLabel('Project name', { exact: true }).fill('Preview focus check')
    await dialog.getByRole('button', { name: 'Close', exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
    await installPreviewDelay(app)
    const select = async (path: string) => {
      await choose(app, path)
      await dialog.getByRole('button', { name: 'Choose a file', exact: true }).click()
    }
    const preview = dialog.getByRole('table', { name: 'Import preview', exact: true })
    await select(first)
    await expect(preview).toContainText('OLD PREVIEW ROW')
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
    await armPreview(app)
    await select(second)
    await expect(preview).toHaveCount(0)
    await expect(dialog.getByRole('status')).toHaveText('Reading selected file…')
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await dialog.getByLabel('Project name', { exact: true }).press('Enter')
    expect(await page.evaluate(() => window.infomonk.list())).toHaveLength(0)
    await select(source)
    await expect(dialog.getByRole('status')).toHaveCount(0)
    await releasePreview(app, true)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(preview).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
    await armPreview(app)
    await select(second)
    await releasePreview(app, true)
    await expect(dialog.getByRole('alert')).toContainText('Synthetic selected-file preview failed')
    await expect(preview).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await select(second)
    await expect(preview).toContainText('NEW PREVIEW ROW 0')
    await expect(preview).not.toContainText('OLD PREVIEW ROW')
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled()
    await dialog.evaluate((element) => (element.scrollTop = 0))
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeInViewport()
    await capture(app, artifacts, 'creator-900-light')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()

    await trigger.click()
    const projectName =
      'Bermuda research and supplier procurement workspace with a long descriptive project name for navigation checks'
    await dialog.getByLabel('Project name', { exact: true }).fill(projectName)
    await select(source)
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible()
    const project = (await page.evaluate(() => window.infomonk.list()))[0]
    const workflow = await page.evaluate(
      ({ projectId, sourceId }) =>
        window.infomonkResearch.save(
          projectId,
          'Supplier procurement comparison with a long descriptive accepted output revision name',
          {
            kind: 'quotes',
            instructions: 'Extract the local synthetic supplier quote.',
            sourceIds: [sourceId],
            fields: ['quote_id', 'supplier', 'date', 'currency', 'total', 'country_code'],
            countries: ['CAN'],
            fromYear: 2023,
            toYear: 2024,
          },
        ),
      { projectId: project.id, sourceId: project.workspace!.sources[0].id },
    )
    const run = await page.evaluate(
      ([projectId, workflowId]) => window.infomonkResearch.run(projectId, workflowId, false),
      [project.id, workflow.id],
    )
    await expect
      .poll(() =>
        page.evaluate(
          async ({ projectId, runId }) =>
            (await window.infomonkResearch.state(projectId)).runs.find((run) => run.id === runId)
              ?.status,
          { projectId: project.id, runId: run.id },
        ),
      )
      .toBe('review')
    await page.evaluate(
      ([projectId, runId]) => window.infomonkResearch.publish(projectId, runId, true, false),
      [project.id, run.id],
    )
    const reviewRun = await page.evaluate(
      ([projectId, workflowId]) => window.infomonkResearch.run(projectId, workflowId, false),
      [project.id, workflow.id],
    )
    await expect
      .poll(() =>
        page.evaluate(
          async ({ projectId, runId }) =>
            (await window.infomonkResearch.state(projectId)).runs.find((run) => run.id === runId)
              ?.status,
          { projectId: project.id, runId: reviewRun.id },
        ),
      )
      .toBe('review')
    const layouts: { width: number; theme: string; section: string }[] = []
    for (const width of [900, 1450]) {
      await resize(app, page, width)
      for (const theme of ['light', 'dark'] as const) {
        await page.evaluate((theme) => window.aiOffice.setTheme(theme), theme)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        for (const section of ['Home', 'Sources', 'Outputs'] as const) {
          await page.getByRole('button', { name: section, exact: true }).click()
          if (section === 'Home') {
            await page.getByRole('button', { name: 'Needs review', exact: true }).click()
            await expect(
              page.getByRole('button', { name: `Review table: ${projectName}`, exact: true }),
            ).toBeVisible()
            await page.getByRole('button', { name: 'Needs review', exact: true }).click()
          } else
            await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
          if (section === 'Outputs') {
            await expect(
              page.locator('.im-source-row').filter({ hasText: 'revision 1' }),
            ).toBeVisible()
          }
          await withinMain(page)
          await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeInViewport()
          await expect(page.getByRole('button', { name: 'Help', exact: true })).toBeInViewport()
          const sidebarWidth = await page
            .locator('.im-sidebar')
            .evaluate((element) => element.getBoundingClientRect().width)
          expect(sidebarWidth).toBe(width === 900 ? 64 : 224)
          await capture(app, artifacts, `${section.toLowerCase()}-${width}-${theme}`)
          layouts.push({ width, theme, section })
        }
      }
    }
    expect(errors).toEqual([])
    writeFileSync(
      join(artifacts, 'results.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          passed: true,
          synthetic: true,
          realLocalPreviewAndResearchService: true,
          delayedResponseOnly: true,
          checks: [
            'Tab and Shift+Tab stay inside creator; Escape returns focus to invoker',
            'Old rows disappear immediately while a different file loads',
            'Pending and failed preview cannot submit the form',
            'Obsolete failed response cannot replace current document selection',
            'Choosing the same file retries preview and clears failed state',
            'Create remains visible with a scrollable import preview',
            'Real local quote project and accepted revision appear in Outputs',
            'Main panels fit both widths/themes with named compact navigation',
          ],
          layouts,
          rendererErrors: errors,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'creator-workspace-ux')
  }
})
