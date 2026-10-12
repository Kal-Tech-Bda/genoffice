import { test, expect, type Page, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'
declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}
const fixture = (name: string) => resolve(__dirname, '../fixtures/infomonk/workspace-flow', name)
const expected = JSON.parse(readFileSync(fixture('expected.json'), 'utf8'))
const artifacts = resolve(__dirname, '../docs/testing/workspace-flow-2026-10-10')
async function choose(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, path)
}
async function capture(app: ElectronApplication, name: string) {
  mkdirSync(artifacts, { recursive: true })
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows()[0],
      sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1800, height: 1200 },
      }),
      source = sources.find((s) => s.id === win.getMediaSourceId())
    if (!source) throw Error('Native capture unavailable')
    return source.thumbnail.toPNG().toString('base64')
  })
  writeFileSync(join(artifacts, name + '.png'), Buffer.from(png, 'base64'))
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
async function totals(page: Page, projectId: string, workflowId: string) {
  const accepted = await page.evaluate(
    ([p, w]) => window.infomonkResearch.accepted(p, w),
    [projectId, workflowId],
  )
  return Object.fromEntries(
    accepted!.tables
      .find((t) => t.id === 'quotes')!
      .rows.map((r) => [String(r.cells.quote_id.value), r.cells.total.value]),
  )
}
test('a user compares supplier quotes, reviews missing facts, versions sources, refreshes and reopens the saved table', async () => {
  test.setTimeout(120_000)
  let launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'workspace-flow',
    env: { GENOFFICE_DEBUG_HOOKS: '1' },
  })
  let phase = 'create-project'
  const checks: { name: string; passed: boolean }[] = [],
    record = (name: string) => {
      checks.push({ name, passed: true })
      phase = name
    }
  const errors: { phase: string; url: string; message: string; stack?: string }[] = []
  let exportPath: string, acceptedPath: string, projectId: string, workflowId: string
  try {
    let { page, app } = launched
    const watch = (app: ElectronApplication) => {
      const watchPage = (page: Page) =>
        page.on('pageerror', (error) =>
          errors.push({ phase, url: page.url(), message: String(error), stack: error.stack }),
        )
      app.windows().forEach(watchPage)
      app.on('window', watchPage)
    }
    watch(app)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 1000))
    await page.getByRole('button', { name: 'Extract from files', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New project', exact: true })
    await expect(dialog).toContainText('labeled supplier quote')
    await dialog.getByLabel('Project name', { exact: true }).fill('Demo: Supplier quote comparison')
    await dialog
      .getByLabel('What do you want to learn?', { exact: true })
      .fill(
        'Compare quotes for five packs of paper in CAD; keep missing facts and reviewer overrides visible.',
      )
    await choose(app, fixture('northwind.txt'))
    await dialog.getByRole('button', { name: 'Choose a file', exact: true }).click()
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible()
    record('File-start creation routes to Sources instead of a blank workbook')
    for (const name of ['cedar.docx', 'maple.pdf']) {
      await choose(app, fixture(name))
      await page.getByRole('button', { name: 'Add a local file', exact: true }).click()
      await expect(page.locator('.im-source-row').filter({ hasText: name })).toBeVisible()
    }
    await page.getByRole('button', { name: 'Build a table from sources', exact: true }).click()
    await page.getByLabel('Workflow name', { exact: true }).fill('Paper quote comparison')
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Run sample', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Candidate — accepted data unchanged', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Publish accepted table', exact: true }),
    ).toBeDisabled()
    const quoteTable = () =>
      page
        .locator('.im-research-table')
        .filter({ has: page.getByRole('heading', { name: /^Quotes ·/ }) })
    await expect(quoteTable().locator('tbody tr')).toHaveCount(1)
    record('A genuine sample has one quote and cannot publish')
    await page.getByRole('button', { name: 'Cancel run', exact: true }).click()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(quoteTable().locator('tbody tr')).toHaveCount(3)
    await page.getByLabel('Show rows needing review', { exact: true }).check()
    await expect(quoteTable().locator('tbody tr')).toHaveCount(1)
    await expect(quoteTable()).toContainText('Q-M001')
    await quoteTable().scrollIntoViewIfNeeded()
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
        ),
    )
    await capture(app, 'missing-facts-review-light')
    await page.getByLabel('I reviewed missing facts, conflicts and validation issues').check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    const project = (await page.evaluate(() => window.infomonk.list())).find(
      (p) => p.name === 'Demo: Supplier quote comparison',
    )!
    projectId = project.id
    workflowId = (await page.evaluate((id) => window.infomonkResearch.state(id), project.id))
      .workflows[0].id
    expect(await totals(page, project.id, workflowId)).toEqual(expected.initial)
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await page.getByRole('button', { name: 'Needs review', exact: true }).click()
    await expect(page.locator('.im-project-row')).toHaveCount(1)
    await expect(page.locator('.im-project-status')).toContainText('1 missing or flagged facts')
    await page
      .getByRole('button', { name: 'Review table: Demo: Supplier quote comparison', exact: true })
      .click()
    await expect(page.getByLabel('Show rows needing review', { exact: true })).toBeChecked()
    await quoteTable()
      .locator('tbody tr')
      .filter({ hasText: 'Q-M001' })
      .getByRole('button', { name: 'Missing', exact: true })
      .click()
    await page.getByLabel('Corrected value', { exact: true }).fill('108')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill(expected.manualCorrection.reason)
    await page.getByRole('button', { name: 'Save persistent correction', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 2', exact: true }),
    ).toBeVisible()
    await expect(quoteTable().locator('tbody tr:not(.im-empty-view)')).toHaveCount(0)
    await expect(quoteTable().getByText('No rows match this view.', { exact: false })).toBeVisible()
    expect(await totals(page, project.id, workflowId)).toEqual(expected.afterCorrection)
    record(
      'Project needs-review filter links to the actual missing fact; manual correction resolves it',
    )
    await expect(page.getByRole('button', { name: 'Sources', exact: true })).toContainText('3')
    await page.getByRole('button', { name: 'Sources', exact: true }).click()
    for (const [before, after] of [
      ['northwind.txt', 'northwind-v2.txt'],
      ['maple.pdf', 'maple-v2.txt'],
    ]) {
      await choose(app, fixture(after))
      await page.getByRole('button', { name: `Update snapshot: ${before}`, exact: true }).click()
      await expect(page.locator('.im-source-row').filter({ hasText: after })).toContainText(
        '1 previous saved versions',
      )
    }
    expect(await totals(page, project.id, workflowId)).toEqual(expected.afterCorrection)
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await page.getByRole('button', { name: 'Needs review', exact: true }).click()
    await expect(page.locator('.im-project-status')).toContainText(
      'Inputs changed · reviewed refresh needed',
    )
    await capture(app, 'home-inputs-changed-light')
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    let sheet = await waitForPageWithUrl(app, '://sheets/')
    await expect
      .poll(() =>
        sheet.evaluate(() =>
          (window as unknown as { __genofficeDebug: any }).__genofficeDebug?.univerAPI
            .getActiveWorkbook()
            ?.getActiveSheet()
            ?.getRange('E4')
            .getValue(),
        ),
      )
      .toBe(108)
    record('Home reopens the accepted working workbook, not the blank starter')
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('button', { name: 'Paper quote comparison', exact: true }).click()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(quoteTable().locator('tbody tr')).toHaveCount(3)
    await expect(quoteTable().locator('tbody tr').filter({ hasText: 'Q-N001' })).toContainText(
      '120',
    )
    await quoteTable()
      .locator('tbody tr')
      .filter({ hasText: 'Q-M001' })
      .getByRole('button', { name: /^108/ })
      .click()
    await page.getByRole('button', { name: 'Verify snapshot and locator', exact: true }).click()
    await expect(page.locator('.im-cell-inspector pre')).toContainText('Total: 115.00')
    await expect(page.locator('.im-cell-inspector')).toContainText('Manual override')
    await page.getByLabel('I reviewed missing facts, conflicts and validation issues').check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeVisible()
    expect(await totals(page, project.id, workflowId)).toEqual(expected.afterReviewedRefresh)
    record(
      'Reviewed refresh updates document facts and retains 108 as manual override beside incoming evidence 115',
    )
    await page.getByRole('button', { name: 'Outputs', exact: true }).click()
    await expect(page.getByText('Current accepted table', { exact: false })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Open Paper quote comparison revision 1', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Activity', exact: true }).click()
    await expect(page.getByText(/corrected total · Synthetic reviewer/)).toBeVisible()
    await expect(
      page.getByText('Paper quote comparison: Accepted revision 3', { exact: true }),
    ).toBeVisible()
    record(
      'Outputs identify current/earlier revisions; Activity contains publication, correction and source update events',
    )
    await page.getByRole('button', { name: 'Sheets', exact: true }).click()
    // Multiple revision tabs stay alive. Select the current accepted sheet by its grid value.
    await expect
      .poll(async () => {
        for (const candidate of app.windows().filter((p) => p.url().includes('://sheets/'))) {
          if (
            (await candidate
              .evaluate(() =>
                (window as unknown as { __genofficeDebug: any }).__genofficeDebug?.univerAPI
                  .getActiveWorkbook()
                  ?.getActiveSheet()
                  ?.getRange('E2')
                  .getValue(),
              )
              .catch(() => null)) === 120
          ) {
            sheet = candidate
            return true
          }
        }
        return false
      })
      .toBe(true)
    phase = 'native-name-box-H1'
    await editCell(sheet, 'H1', 'Lowest accepted quote (CAD)')
    phase = 'native-name-box-H2'
    await editCell(sheet, 'H2', '=MIN(E2:E4)')
    await expect
      .poll(() =>
        sheet.evaluate(() =>
          (window as unknown as { __genofficeDebug: any }).__genofficeDebug.univerAPI
            .getActiveWorkbook()
            .getActiveSheet()
            .getRange('H2')
            .getValue(),
        ),
      )
      .toBe(90)
    phase = 'native-save'
    await sheet.locator('.ribbon-tabs > .qa-btn').first().click()
    const current = (await page.evaluate(() => window.infomonk.list())).find(
      (p) => p.id === project.id,
    )!
    acceptedPath = current.workspace!.workingWorkbook!
    await expect
      .poll(async () =>
        (await JSZip.loadAsync(readFileSync(acceptedPath)))
          .file('xl/worksheets/sheet1.xml')!
          .async('string'),
      )
      .toContain('MIN(E2:E4)')
    exportPath = join(mkdtempSync(join(tmpdir(), 'infomonk-flow-export-')), 'comparison.xlsx')
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: path,
      })) as typeof dialog.showSaveDialog
    }, exportPath)
    await page.getByRole('button', { name: 'Export workbook', exact: true }).click()
    await expect
      .poll(() => {
        try {
          return readFileSync(exportPath).equals(readFileSync(acceptedPath))
        } catch {
          return false
        }
      })
      .toBe(true)
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await expect(sheet.locator('html')).toHaveAttribute('data-theme', 'dark')
    await capture(app, 'comparison-sheet-dark')
    record(
      'Native formula yields the independently expected lowest CAD quote of 90; save and XLSX export preserve the actual workbook',
    )
    const profile = launched.userDataDir
    phase = 'close-first-session'
    await closeAndSaveVideo(launched, 'supplier-comparison-first-session')
    phase = 'reopen-saved-project'
    launched = await launchShell({
      userDataDir: profile,
      videoDir: 'workspace-flow',
      env: { GENOFFICE_DEBUG_HOOKS: '1' },
    })
    ;({ page, app } = launched)
    watch(app)
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    sheet = await waitForPageWithUrl(app, '://sheets/')
    await expect
      .poll(() =>
        sheet.evaluate(() =>
          (window as unknown as { __genofficeDebug: any }).__genofficeDebug?.univerAPI
            .getActiveWorkbook()
            ?.getActiveSheet()
            ?.getRange('H2')
            .getValue(),
        ),
      )
      .toBe(90)
    expect(await totals(page, project.id, workflowId)).toEqual(expected.afterReviewedRefresh)
    const name = sheet.locator('[data-u-comp="defined-name"] input')
    await expect(sheet.locator('main[inert]')).toHaveCount(0)
    await name.fill('E4')
    await name.press('Enter')
    await sheet.getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(sheet.locator('.im-cell-evidence')).toContainText('Accepted value: 108 · manual')
    await sheet.getByRole('button', { name: 'Inspect snapshot', exact: true }).first().click()
    await expect(sheet.locator('.im-cell-evidence pre')).toContainText('Total: 115.00')
    await capture(app, 'reopened-manual-evidence-dark')
    record(
      'Fresh-process reopen retains formula, selected accepted workbook, manual value and current source evidence',
    )
    writeFileSync(
      join(artifacts, 'use-case-results.json'),
      JSON.stringify(
        {
          synthetic: true,
          profile,
          projectId,
          workflowId,
          acceptedPath,
          exportPath,
          checks,
          rendererErrors: errors,
          expected,
          finalAccepted: await totals(page, project.id, workflowId),
        },
        null,
        2,
      ) + '\n',
    )
    expect(errors).toEqual([])
  } finally {
    await closeAndSaveVideo(launched, 'supplier-comparison-reopened')
  }
})

test('Research the web starts at the supported public task and accurately explains reference-only links', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'workspace-flow' })
  try {
    const { page } = launched
    await page.getByRole('button', { name: 'Research the web', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New project', exact: true })
    await expect(dialog).toContainText('arbitrary website collection is not available')
    await dialog.getByLabel('Project name', { exact: true }).fill('Public population setup')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible()
    await expect(page.getByLabel('Research task', { exact: true })).toHaveValue('worldbank')
    await expect(page.getByText('Public World Bank V2 API', { exact: false })).toBeVisible()
  } finally {
    await closeAndSaveVideo(launched, 'public-task-start')
  }
})
