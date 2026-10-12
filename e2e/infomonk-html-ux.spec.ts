import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo } from './helpers'
import { RESEARCH_CHANNEL, type ResearchApi } from '../apps/shell/src/shared/research-api'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'

declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}

const artifacts = resolve(__dirname, 'artifacts/html-ux-2026-10-12')
const html = `<h2>Product catalogue</h2><p>Codes are stable source identifiers; descriptions remain literal text.</p>
<table><caption>Stable codes</caption><tr><th>Code</th><th>Description</th></tr>
<tr><td>SKU-001</td><td>First item</td></tr><tr><td>SKU-002</td><td>Second item</td></tr><tr><td>SKU-003</td><td>Third item</td></tr></table>
<h2>Source rates</h2><p>Rates are in USD per item; provisional source values.</p>
<table><caption>Rates</caption><tr><td>Code</td><td>Rate</td></tr>
<tr><td>SKU-001</td><td>1.50 USD</td></tr><tr><td>SKU-002</td><td>2.00 USD</td></tr></table>
<h2>Grouped data</h2><table><caption>Grouped data</caption><tr><th>Code</th><th>Amount</th></tr>
<tr><td rowspan="2">A</td><td>1</td></tr><tr><td>2</td></tr></table>`

async function capture(app: ElectronApplication, name: string) {
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const source = (
      await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1800, height: 1200 },
      })
    ).find((value) => value.id === win.getMediaSourceId())
    if (!source) throw Error('Native capture unavailable')
    return source.thumbnail.toPNG().toString('base64')
  })
  writeFileSync(join(artifacts, name + '.png'), Buffer.from(png, 'base64'))
}

test('whole-table setup explains missing sources, announces loading, supports keyboard discovery and exposes accessible previews', async () => {
  test.setTimeout(150_000)
  mkdirSync(artifacts, { recursive: true })
  const directory = mkdtempSync(join(artifacts, 'fixture-')),
    source = join(directory, 'catalogue.html')
  writeFileSync(source, html)
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'html-ux' })
  const { app, page } = launched,
    errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 1000))
    const project = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Whole-table accessible setup',
        description: 'Synthetic HTML setup and preview; no network source',
        startKind: 'researchWeb',
      }),
    )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Research task', { exact: true }).selectOption('htmlTables')
    await page.getByLabel('Workflow name', { exact: true }).fill('Accessible catalogue')
    const input = page.getByRole('region', { name: 'Whole website table input', exact: true })
    const find = input.getByRole('button', { name: 'Find tables on this page', exact: true })
    await input.getByLabel('Table source', { exact: true }).selectOption('file')
    await expect(
      input.getByLabel('Saved HTML source', { exact: true }),
    ).toHaveAccessibleDescription(/Add an HTML file in Sources/)
    await expect(find).toBeDisabled()

    // This rejected HTTP URL exercises Enter and the real boundary validator,
    // without sending any network request or substituting the service/parser.
    await input.getByLabel('Table source', { exact: true }).selectOption('web')
    const url = input.getByLabel('Public table URL', { exact: true })
    await url.fill('http://localhost/private')
    await url.press('Enter')
    await expect(input.getByRole('alert')).toContainText('HTTPS')
    await expect(page.getByRole('button', { name: 'Save workflow', exact: true })).toBeDisabled()

    await page.evaluate(({ id, path }) => window.infomonk.addSource(id, { path }), {
      id: project.id,
      path: source,
    })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await input.getByLabel('Table source', { exact: true }).selectOption('file')
    const saved = input.getByLabel('Saved HTML source', { exact: true })
    await expect(saved.locator('option').filter({ hasText: 'catalogue.html' })).toHaveCount(1)
    await saved.selectOption({ label: 'catalogue.html' })
    await expect(saved).not.toHaveAccessibleDescription(/Add an HTML file in Sources/)
    await expect(find).toBeEnabled()

    // Delay only the real IPC response so the in-flight announcement can be observed.
    await app.evaluate(({ ipcMain }, channel) => {
      const original = (
        ipcMain as unknown as {
          _invokeHandlers: Map<
            string,
            (event: unknown, method: string, ...args: unknown[]) => unknown
          >
        }
      )._invokeHandlers.get(channel)
      if (!original) throw Error('Research IPC handler unavailable')
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, method: string, ...args: unknown[]) => {
        const result = await original(event, method, ...args)
        if (method === 'discoverTables')
          await new Promise<void>((done) => {
            ;(globalThis as unknown as { htmlUxRelease: () => void }).htmlUxRelease = done
          })
        return result
      })
    }, RESEARCH_CHANNEL)
    await find.click()
    await expect(
      input
        .getByRole('status')
        .filter({ hasText: 'Reading the source and identifying complete tables' }),
    ).toBeVisible()
    await expect(input.getByLabel('Saved HTML source', { exact: true })).toBeDisabled()
    await expect
      .poll(() =>
        app.evaluate(
          () => typeof (globalThis as unknown as { htmlUxRelease?: () => void }).htmlUxRelease,
        ),
      )
      .toBe('function')
    await app.evaluate(() => {
      const fixture = globalThis as unknown as { htmlUxRelease?: () => void }
      fixture.htmlUxRelease!()
      delete fixture.htmlUxRelease
    })
    await expect(input.getByRole('status').filter({ hasText: '3 tables found' })).toBeVisible()
    await expect(input.getByRole('status').filter({ hasText: 'No tables selected' })).toBeVisible()
    const unsupported = input.getByLabel('Use Grouped data (2 rows)', { exact: true })
    await expect(unsupported).toBeDisabled()
    await expect(unsupported).toHaveAccessibleDescription(/Rowspan\/colspan cells are unsupported/)

    await input.getByRole('button', { name: 'Select all supported tables', exact: true }).click()
    const headers = input.getByLabel('First row contains column names in selected tables', {
      exact: true,
    })
    await expect(headers).toHaveAttribute('aria-checked', 'mixed')
    expect(await headers.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(
      true,
    )
    await expect(
      input
        .getByRole('status')
        .filter({ hasText: '2 tables selected · 1 need header confirmation · 2 need record keys' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save workflow', exact: true })).toBeDisabled()
    await input
      .locator('summary')
      .filter({ hasText: /^Preview Stable codes/ })
      .click()
    const preview = input.getByRole('table', {
      name: 'Stable codes preview: first 3 of 3 source rows',
      exact: true,
    })
    await expect(preview).toBeVisible()
    await expect(preview.getByRole('columnheader', { name: 'Code', exact: true })).toHaveAttribute(
      'scope',
      'col',
    )
    await expect(preview.getByRole('row')).toHaveCount(4)
    await expect(preview).toContainText('SKU-003')
    await headers.focus()
    await headers.press('Space')
    await expect(headers).toBeChecked()
    await expect(headers).toHaveAttribute('aria-checked', 'true')
    expect(await headers.evaluate((element) => (element as HTMLInputElement).indeterminate)).toBe(
      false,
    )
    await input.getByRole('button', { name: 'Use first column as record key', exact: true }).click()
    await expect(
      input
        .getByRole('status')
        .filter({ hasText: '2 tables selected · 0 need header confirmation · 0 need record keys' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save workflow', exact: true })).toBeEnabled()

    const rates = input
      .locator('.im-html-table-choice')
      .filter({ has: page.getByLabel('Use Rates (2 rows)', { exact: true }) })
    await rates
      .locator('summary')
      .filter({ hasText: /^Source context notes/ })
      .click()
    await expect(rates).toContainText('Rates are in USD per item; provisional source values.')
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    await input.evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await capture(app, 'whole-table-setup-light')
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await preview.scrollIntoViewIfNeeded()
    await capture(app, 'whole-table-preview-dark')
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.workflows).toHaveLength(1)
    expect(state.workflows[0].config.htmlTables!.selections).toHaveLength(2)
    expect(
      state.workflows[0].config.htmlTables!.selections.every(
        (selection) => selection.confirmFirstRowAsHeader && selection.keyColumns.length === 1,
      ),
    ).toBe(true)
    expect(state.runs).toHaveLength(0)
    expect(errors).toEqual([])
    writeFileSync(
      join(artifacts, 'journey.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          synthetic: true,
          realServiceAndParser: true,
          publicNetworkRequests: 0,
          discoveredTables: 3,
          selectedTables: 2,
          unsupportedTableExcluded: true,
          mixedHeadersConfirmedByKeyboard: true,
          namedPreviewColumnHeaders: true,
          savedConfigurationOnly: true,
          rendererErrors: errors,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'html-ux')
  }
})
