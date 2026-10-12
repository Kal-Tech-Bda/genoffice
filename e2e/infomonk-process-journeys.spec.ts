import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import JSZip from 'jszip'
import { join, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl, type LaunchedApp } from './helpers'
import type { WorkspaceApi, WorkspaceProject } from '../apps/shell/src/shared/workspace-api'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'
declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}
const artifacts = resolve(__dirname, '../docs/testing/process-journeys-2026-10-11')
const research = (name: string) => resolve(__dirname, '../fixtures/infomonk/research', name)
const suppliers = (name: string) => resolve(__dirname, '../fixtures/infomonk/workspace-flow', name)
const unsupported = resolve(__dirname, '../fixtures/infomonk/journeys/unsupported.txt')
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
    const win = BrowserWindow.getAllWindows()[0]
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1800, height: 1200 },
    })
    const source = sources.find((s) => s.id === win.getMediaSourceId())
    if (!source) throw Error('Native capture unavailable')
    return source.thumbnail.toPNG().toString('base64')
  })
  writeFileSync(join(artifacts, name + '.png'), Buffer.from(png, 'base64'))
}
function watch(launched: LaunchedApp) {
  const errors: string[] = []
  const listen = (page: Page) =>
    page.on('pageerror', (error) => errors.push(`${page.url()}: ${error}`))
  launched.app.windows().forEach(listen)
  launched.app.on('window', listen)
  return errors
}
async function prepare(page: Page, app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 1000))
  await page.evaluate(() => window.aiOffice.setTheme('light'))
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
}
async function create(page: Page, app: ElectronApplication, file: string, name: string) {
  await page.getByRole('button', { name: 'Extract from files', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New project', exact: true })
  await dialog.getByLabel('Project name', { exact: true }).fill(name)
  await dialog
    .getByLabel('What do you want to learn?', { exact: true })
    .fill('Check synthetic quote facts, coverage and review decisions.')
  await choose(app, file)
  await dialog.getByRole('button', { name: 'Choose a file', exact: true }).click()
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible()
}
async function add(page: Page, app: ElectronApplication, path: string) {
  await choose(app, path)
  await page.getByRole('button', { name: 'Add a local file', exact: true }).click()
  await expect(
    page.locator('.im-source-row').filter({ hasText: path.split(/[\\/]/).pop()! }),
  ).toBeVisible()
}
async function workflow(page: Page, name: string) {
  await page.getByRole('button', { name: 'Build a table from sources', exact: true }).click()
  await page.getByLabel('Workflow name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
}
const table = (page: Page, name: string) =>
  page
    .locator('.im-research-table')
    .filter({ has: page.getByRole('heading', { name: new RegExp(`^${name} ·`) }) })
async function acknowledge(page: Page) {
  await page
    .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
    .check()
}
async function publish(page: Page) {
  await acknowledge(page)
  await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
  await expect(page.getByRole('heading', { name: /^Accepted revision / })).toBeVisible()
}
async function ids(page: Page, name: string) {
  const project = (await page.evaluate(() => window.infomonk.list())).find((p) => p.name === name)!
  const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
  return { project, workflow: state.workflows[0] }
}
function record(
  name: string,
  launched: LaunchedApp,
  project: WorkspaceProject,
  workflowId: string,
  checks: string[],
  errors: string[],
) {
  mkdirSync(artifacts, { recursive: true })
  writeFileSync(
    join(artifacts, name + '.json'),
    JSON.stringify(
      {
        date: '2026-10-11',
        profile: launched.userDataDir,
        projectId: project.id,
        workflowId,
        checks,
        rendererErrors: errors,
      },
      null,
      2,
    ) + '\n',
  )
}

test('spreadsheet cleanup: preview and discard, return to the editor, apply and switch workbook versions', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'process-journeys' })
  const { page, app } = launched,
    errors = watch(launched)
  const source = resolve(__dirname, '../fixtures/infomonk/journeys/supplier-register.csv')
  const original = readFileSync(source)
  try {
    await prepare(page, app)
    await page.getByRole('button', { name: 'Work with a spreadsheet', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New project', exact: true })
    await dialog.getByLabel('Project name', { exact: true }).fill('Supplier register cleanup')
    await choose(app, source)
    await dialog.getByRole('button', { name: 'Choose a file', exact: true }).click()
    await expect(dialog.getByRole('table', { name: 'Import preview', exact: true })).toBeVisible()
    await expect(dialog.locator('table')).toContainText('001')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    const sheet = await waitForPageWithUrl(app, '://sheets/')
    await expect(sheet.locator('main.app-shell')).toHaveAttribute('aria-busy', 'false')
    const project = (await page.evaluate(() => window.infomonk.list())).find(
      (p) => p.name === 'Supplier register cleanup',
    )!
    const starter = project.workspace!.primaryWorkbook
    const starterBytes = readFileSync(starter)
    const clean = async () => {
      await page.getByRole('button', { name: 'Clean table', exact: true }).click()
      await page.getByRole('button', { name: 'Inspect saved table', exact: true }).click()
      await expect(page.getByLabel('Column name 1', { exact: true })).toHaveValue('ID')
    }
    await clean()
    await page.getByLabel('Duplicate keys ID', { exact: true }).check()
    await page.getByLabel('Keep the first row for each key', { exact: true }).check()
    await page.getByLabel('Sort by', { exact: true }).selectOption('0')
    await page.getByRole('button', { name: 'Preview changes', exact: true }).click()
    await expect(page.locator('.im-preview')).toContainText('1 Duplicates removed')
    await expect(page.locator('.im-preview')).toContainText(
      'Rows with missing duplicate keys were retained.',
    )
    await page.locator('.im-preview').scrollIntoViewIfNeeded()
    await capture(app, 'cleanup-preview-light')
    await page.getByRole('button', { name: 'Discard preview', exact: true }).click()
    expect(readFileSync(starter)).toEqual(starterBytes)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.locator('.im-workspace')).toHaveClass(/im-editor-active/)
    await expect(sheet.locator('main.app-shell')).toHaveAttribute('aria-busy', 'false')
    await clean()
    await page.getByLabel('Duplicate keys ID', { exact: true }).check()
    await page.getByLabel('Keep the first row for each key', { exact: true }).check()
    await page.getByLabel('Sort by', { exact: true }).selectOption('0')
    await page.getByRole('button', { name: 'Preview changes', exact: true }).click()
    await page.getByRole('button', { name: 'Apply to a new workbook', exact: true }).click()
    await expect(page.locator('.im-workspace')).toHaveClass(/im-editor-active/)
    const applied = (await page.evaluate(() => window.infomonk.list())).find(
      (p) => p.id === project.id,
    )!
    const cleaned = applied.workspace!.primaryWorkbook
    expect(cleaned).not.toBe(starter)
    expect(applied.workspace!.workingWorkbook).toBe(cleaned)
    const cleanedBytes = readFileSync(cleaned)
    const zip = await JSZip.loadAsync(cleanedBytes)
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">001</t>')
    expect(xml).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Alpha</t>')
    expect(xml).toContain('<c r="C2"><v>10</v>')
    expect(xml).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">002</t>')
    expect(xml).toContain('Unassigned')
    expect(xml).not.toContain('Duplicate</t>')
    expect(readFileSync(source)).toEqual(original)
    expect(readFileSync(starter)).toEqual(starterBytes)
    await page.getByRole('button', { name: 'Clean table', exact: true }).click()
    await page.getByRole('button', { name: 'Previous workbook version', exact: true }).click()
    const reverted = (await page.evaluate(() => window.infomonk.list())).find(
      (p) => p.id === project.id,
    )!
    expect(reverted.workspace!.primaryWorkbook).toBe(starter)
    expect(reverted.workspace!.workingWorkbook).toBe(starter)
    expect(readFileSync(cleaned)).toEqual(cleanedBytes)
    expect(errors).toEqual([])
    record(
      'spreadsheet-cleanup',
      launched,
      project,
      '',
      [
        'Leading-zero IDs visible in import preview',
        'Missing duplicate key survives and no ID is invented',
        'Discard leaves saved bytes unchanged',
        'Close returns to actual editor',
        'Apply writes separate cleaned XLSX with independently expected rows',
        'Previous workbook version restores starter; originals survive',
      ],
      errors,
    )
  } finally {
    await closeAndSaveVideo(launched, 'spreadsheet-cleanup')
  }
})

test('mixed documents: readiness repair, sample to full, conflicting evidence and a reviewed correction', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'process-journeys' })
  const { page, app } = launched,
    errors = watch(launched)
  try {
    await prepare(page, app)
    await create(page, app, research('valid.txt'), 'Mixed document review')
    await add(page, app, research('conflict.txt'))
    await add(page, app, unsupported)
    await workflow(page, 'Mixed quote inputs')
    await page.getByRole('button', { name: 'Run sample', exact: true }).click()
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: 'Publish accepted table', exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }),
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    const readiness = page.getByRole('region', { name: 'Input readiness', exact: true })
    await expect(readiness).toContainText('1 blocked')
    await expect(
      page.getByRole('button', { name: 'Publish accepted table', exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }),
    ).toBeDisabled()
    await expect(readiness.getByText(/Unsupported document family/)).toBeVisible()
    await readiness.scrollIntoViewIfNeeded()
    await capture(app, 'mixed-input-coverage-light')
    const { project, workflow: saved } = await ids(page, 'Mixed document review')
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.runs).toHaveLength(1)
    expect(state.runs[0].sample).toBe(true)
    expect(state.runs[0].status).toBe('review')
    expect(saved.acceptedRevision).toBe(0)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel(/unsupported.txt ·/).uncheck()
    await page.getByRole('button', { name: 'Save new configuration version', exact: true }).click()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(1)
    await expect(
      table(page, 'Quotes').getByRole('button', { name: 'Missing', exact: true }),
    ).toBeVisible()
    await table(page, 'Quotes').getByRole('button', { name: 'Missing', exact: true }).click()
    await expect(page.locator('.im-cell-inspector')).toContainText('conflicting')
    await expect(page.locator('.im-cell-inspector article')).toHaveCount(3)
    await page
      .locator('.im-cell-inspector')
      .getByRole('button', { name: 'Verify snapshot and locator', exact: true })
      .first()
      .click()
    await expect(page.locator('.im-cell-inspector pre')).toContainText('Total: 125.50')
    await publish(page)
    await table(page, 'Quotes').getByRole('button', { name: 'Q-100', exact: true }).click()
    await expect(page.locator('.im-cell-inspector')).toContainText('defines record identity')
    await expect(page.getByLabel('Corrected value', { exact: true })).toHaveCount(0)
    await table(page, 'Quotes').getByRole('button', { name: 'Missing', exact: true }).click()
    await page.getByLabel('Corrected value', { exact: true }).fill('-1')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill('Synthetic invalid negative total')
    await page.getByRole('button', { name: 'Save persistent correction', exact: true }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Correction must be a nonnegative' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    await page.getByLabel('Corrected value', { exact: true }).fill('130')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill('Reviewer accepted the second labeled total; disagreement remains in source evidence.')
    await page.getByRole('button', { name: 'Save persistent correction', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 2', exact: true }),
    ).toBeVisible()
    await expect(
      table(page, 'Quotes').getByRole('button', { name: '130 Manual override', exact: true }),
    ).toBeVisible()
    await table(page, 'Quotes').scrollIntoViewIfNeeded()
    await capture(app, 'reviewed-conflict-light')
    expect(errors).toEqual([])
    record(
      'mixed-documents',
      launched,
      project,
      saved.id,
      [
        'Sample advances directly to full and stays in history',
        'Unsupported input blocks full execution before a new run exists',
        'Explicit scope repair obsoletes the earlier sample',
        'Duplicate quote resolves to one row with three conflicting excerpts',
        'Record key is read only',
        'Invalid negative correction is rejected without advancing the accepted revision',
        'Reviewed correction publishes 130 and preserves evidence',
      ],
      errors,
    )
  } finally {
    await closeAndSaveVideo(launched, 'mixed-documents')
  }
})

test('source removal: default retention, protected relationships and explicit removal of unprotected rows', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'process-journeys' })
  const { page, app } = launched,
    errors = watch(launched)
  try {
    await prepare(page, app)
    await create(page, app, suppliers('northwind.txt'), 'Reviewed source removal')
    await add(page, app, suppliers('cedar.docx'))
    await add(page, app, suppliers('maple.pdf'))
    await workflow(page, 'Removal policy')
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(3)
    await publish(page)
    const cedar = table(page, 'Line items').locator('tbody tr').filter({ hasText: 'Q-C001' })
    await cedar.getByRole('button', { name: '5', exact: true }).click()
    await page.getByLabel('Corrected value', { exact: true }).fill('4')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill('Synthetic reviewer confirmed four packs for Cedar.')
    await page.getByRole('button', { name: 'Save persistent correction', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 2', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel(/northwind.txt ·/).uncheck()
    await page.getByLabel(/cedar.docx ·/).uncheck()
    await page.getByRole('button', { name: 'Save new configuration version', exact: true }).click()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(1)
    await page.getByText('Records absent from this acquisition · 4', { exact: true }).click()
    await expect(page.getByText('4 absent records', { exact: false })).toBeVisible()
    await expect(
      page.getByLabel('Remove absent records after review (manual overrides are retained)', {
        exact: true,
      }),
    ).not.toBeChecked()
    await publish(page)
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(3)
    await expect(table(page, 'Line items').locator('tbody tr')).toHaveCount(3)
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(1)
    await page
      .getByLabel('Remove absent records after review (manual overrides are retained)', {
        exact: true,
      })
      .check()
    await publish(page)
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(2)
    await expect(table(page, 'Quotes')).not.toContainText('Q-N001')
    await expect(table(page, 'Quotes')).toContainText('Q-C001')
    await expect(table(page, 'Line items').locator('tbody tr')).toHaveCount(2)
    await expect(
      cedar.getByRole('button', { name: '4 Manual override', exact: true }),
    ).toBeVisible()
    await table(page, 'Line items').scrollIntoViewIfNeeded()
    await capture(app, 'protected-related-records-light')
    const { project, workflow: saved } = await ids(page, 'Reviewed source removal')
    expect(saved.acceptedRevision).toBe(4)
    expect(errors).toEqual([])
    record(
      'source-removal',
      launched,
      project,
      saved.id,
      [
        'Default retains all three quote relationships',
        'Explicit removal deletes unprotected Northwind',
        'Corrected Cedar item retains its parent quote and siblings',
        'Maple missing total remains missing',
        'Four immutable accepted revisions remain',
      ],
      errors,
    )
  } finally {
    await closeAndSaveVideo(launched, 'source-removal')
  }
})

test('workflow reuse: new project routes to confirmed inputs and publishes independently', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'process-journeys' })
  const { page, app } = launched,
    errors = watch(launched)
  try {
    await prepare(page, app)
    await create(page, app, research('valid.txt'), 'Original template project')
    await workflow(page, 'Repeatable quotes')
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(1)
    await publish(page)
    const original = await ids(page, 'Original template project')
    await page
      .getByRole('button', { name: 'Start a new project from this workflow', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: 'New project', exact: true })
    await dialog.getByLabel('Project name', { exact: true }).fill('Independent next batch')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible()
    await expect(
      page.getByText('This workflow needs confirmed inputs before it can run.', { exact: false }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run sample', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Choose workflow inputs', exact: true }).click()
    await expect(page.getByLabel('Workflow instructions', { exact: true })).toHaveValue(
      'Extract labeled supplier quotes; leave unsupported or missing facts for review.',
    )
    await capture(app, 'copied-workflow-inputs-light')
    await page.getByRole('button', { name: 'Sources', exact: true }).click()
    await add(page, app, research('valid.txt'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Repeatable quotes', exact: true }).click()
    await page.getByRole('button', { name: 'Choose workflow inputs', exact: true }).click()
    await page.getByLabel(/valid.txt ·/).check()
    await page.getByRole('button', { name: 'Save new configuration version', exact: true }).click()
    await page.getByRole('button', { name: 'Run sample', exact: true }).click()
    await expect(table(page, 'Quotes').locator('tbody tr')).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }),
    ).toBeEnabled()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await acknowledge(page)
    await expect(
      page.getByRole('button', { name: 'Publish accepted table', exact: true }),
    ).toBeEnabled()
    await publish(page)
    const copied = await ids(page, 'Independent next batch')
    expect(copied.workflow.acceptedRevision).toBe(1)
    expect(copied.workflow.scheduleMinutes).toBeNull()
    const originalState = await page.evaluate(
      (id) => window.infomonkResearch.state(id),
      original.project.id,
    )
    expect(originalState.workflows[0].acceptedRevision).toBe(1)
    await table(page, 'Quotes').scrollIntoViewIfNeeded()
    await capture(app, 'independent-workflow-light')
    expect(errors).toEqual([])
    record(
      'workflow-reuse',
      launched,
      copied.project,
      copied.workflow.id,
      [
        'New project opens copied workflow with empty confirmed scope',
        'Choose inputs opens and scrolls configuration',
        'New source requires explicit selection',
        'Sample advances to full without cancellation',
        'New accepted revision has separate identity; original remains revision 1',
      ],
      errors,
    )
  } finally {
    await closeAndSaveVideo(launched, 'workflow-reuse')
  }
})
