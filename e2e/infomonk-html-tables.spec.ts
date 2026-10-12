import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
const artifacts = resolve(__dirname, '../docs/testing/persona-iteration-2026-10-11')
async function capture(app: ElectronApplication, name: string) {
  mkdirSync(artifacts, { recursive: true })
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const source = (
      await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1800, height: 1200 },
      })
    ).find((s) => s.id === win.getMediaSourceId())
    if (!source) throw Error('Native capture unavailable')
    return source.thumbnail.toPNG().toString('base64')
  })
  writeFileSync(join(artifacts, name + '.png'), Buffer.from(png, 'base64'))
}
function html(changed = false, broken = false) {
  return `<h2>Catalogue</h2><table><tr><th>Code</th><th>Description</th><th>Amount</th></tr>${Array.from({ length: 205 }, (_, i) => `<tr><td>${String(i).padStart(6, '0')}</td><td>${i === 4 ? '=SUM(A1:A2)' : changed && i === 204 ? 'Revised source description' : 'Item ' + i}</td><td>${((i % 10) + 0.25).toFixed(2)}</td></tr>`).join('')}${broken ? '' : '</table>'}<p>Amounts are source text, not converted currency. ${changed ? 'Verify revised description.' : 'Review original terms.'}</p>`
}
test('persona: collect a complete HTML table, inspect page three, retain a correction and restart', async () => {
  test.setTimeout(180_000)
  mkdirSync(resolve(__dirname, 'artifacts'), { recursive: true })
  const directory = mkdtempSync(resolve(__dirname, 'artifacts/html-table-fixture-')),
    source = join(directory, 'catalogue.html')
  writeFileSync(source, html())
  let launched = await launchShell({ onboardingSeen: true, videoDir: 'html-table-persona' })
  let page = launched.page
  const profile = launched.userDataDir,
    errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1450, 1000),
    )
    const project = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Sample Priya — whole table capture',
        description: 'Synthetic 205-row source; no generated code',
        startKind: 'researchWeb',
      }),
    )
    await page.evaluate(
      ([id, path]) => window.infomonk.addSource(id, { path }),
      [project.id, source],
    )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Research task', { exact: true }).selectOption('htmlTables')
    await page.getByLabel('Workflow name', { exact: true }).fill('Whole catalogue')
    await page.getByRole('combobox', { name: 'Table source', exact: true }).selectOption('file')
    await page.getByRole('button', { name: 'Find tables on this page', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: '1 tables found · 205 source rows' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Select all supported tables', exact: true }).click()
    await page.getByRole('button', { name: 'Use first column as record key', exact: true }).click()
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Run sample', exact: true }).click()
    const table = page
      .locator('.im-research-table')
      .filter({ has: page.getByRole('heading', { name: /^Catalogue ·/ }) })
    await expect(
      table.getByRole('heading', { name: 'Catalogue · 20 rows', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Publish accepted table', exact: true }),
    ).toBeDisabled()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(
      table.getByRole('heading', { name: 'Catalogue · 205 rows', exact: true }),
    ).toBeVisible()
    await table.getByRole('button', { name: 'Next Catalogue rows', exact: true }).click()
    await table.getByRole('button', { name: 'Next Catalogue rows', exact: true }).click()
    await expect(table.locator('tbody tr')).toHaveCount(5)
    await table.getByRole('button', { name: '000204', exact: true }).click()
    await page.getByRole('button', { name: 'Verify snapshot and locator', exact: true }).click()
    await expect(page.locator('.im-cell-inspector')).toContainText('000204')
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    await table.getByRole('button', { name: 'Next Catalogue rows', exact: true }).click()
    await table.getByRole('button', { name: 'Next Catalogue rows', exact: true }).click()
    await table.getByRole('button', { name: '000204', exact: true }).click()
    await expect(page.locator('.im-cell-inspector')).toContainText('defines record identity')
    await expect(
      page.getByRole('button', { name: 'Save persistent correction', exact: true }),
    ).toHaveCount(0)
    await table.getByRole('button', { name: 'Item 204', exact: true }).click()
    await page.getByLabel('Corrected value', { exact: true }).fill('Reviewed description')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill('Synthetic reviewer correction')
    await page.getByRole('button', { name: 'Save persistent correction', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 2', exact: true }),
    ).toBeVisible()
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id),
      workflow = state.workflows[0]
    const sources = await page.evaluate(() => window.infomonk.list()),
      sourceId = sources.find((p) => p.id === project.id)!.workspace!.sources[0].id
    writeFileSync(source, html(true))
    await page.evaluate(
      ([p, s, path]) => window.infomonk.updateSource(p, s, path),
      [project.id, sourceId, source],
    )
    await page.getByRole('button', { name: 'Refresh website tables', exact: true }).click()
    await expect(page.getByText('Source context notes changed', { exact: false })).toBeVisible()
    await expect(
      table.getByRole('heading', { name: 'Catalogue · 205 rows', exact: true }),
    ).toBeVisible()
    await table.getByRole('button', { name: 'Next Catalogue rows', exact: true }).click()
    await table.getByRole('button', { name: 'Next Catalogue rows', exact: true }).click()
    await expect(table).toContainText('Reviewed description')
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeVisible()
    const updated = await page.evaluate(
        ([p, w]) => window.infomonkResearch.state(p, 0, w),
        [project.id, workflow.id],
      ),
      destination = updated.workflows[0].destination!
    const zip = await JSZip.loadAsync(readFileSync(destination)),
      metadata = JSON.parse(await zip.file('infomonk/research.json')!.async('string')),
      rows = metadata.dataset.tables[0].rows
    expect(rows).toHaveLength(205)
    expect(rows[204].cells.column_1.value).toBe('000204')
    expect(rows[204].cells.column_2.value).toBe('Reviewed description')
    expect(rows[4].cells.column_2.value).toBe('=SUM(A1:A2)')
    expect(
      rows.reduce(
        (sum: number, r: { cells: { column_3: { value: string } } }) =>
          sum + Number(r.cells.column_3.value),
        0,
      ),
    ).toBe(961.25)
    expect(metadata.attribution).toContain('Captured public HTML or project-provided HTML')
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('>Code</t>')
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).not.toContain(
      '<f>SUM(A1:A2)</f>',
    )
    writeFileSync(source, html(true, true))
    await page.evaluate(
      ([p, s, path]) => window.infomonk.updateSource(p, s, path),
      [project.id, sourceId, source],
    )
    await page.getByRole('button', { name: 'Refresh website tables', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'closing tag' })).toBeVisible()
    expect(
      (await page.evaluate((id) => window.infomonkResearch.state(id), project.id)).workflows[0]
        .acceptedRevision,
    ).toBe(3)
    await closeAndSaveVideo(launched, 'html-table-persona')
    launched = await launchShell({ userDataDir: profile, videoDir: 'html-table-reopen' })
    page = launched.page
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Whole catalogue', exact: true }).click()
    await page.getByRole('button', { name: 'Inspect accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeVisible()
    const reopened = await page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w, { offset: 200 }),
      [project.id, workflow.id],
    )
    expect(reopened!.tables[0].rows[4].cells.column_2.value).toBe('Reviewed description')
    await page.evaluate(([p, w]) => window.infomonkResearch.open(p, w), [project.id, workflow.id])
    const sheet = await waitForPageWithUrl(launched.app, '://sheets/')
    await expect(sheet.locator('main.app-shell')).toHaveAttribute('aria-busy', 'false')
    await sheet.locator('[data-u-comp="defined-name"] input').fill('B206')
    await sheet.locator('[data-u-comp="defined-name"] input').press('Enter')
    await sheet.getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(sheet.locator('.im-cell-evidence')).toContainText('Reviewed description')
    await expect(sheet.locator('.im-cell-evidence')).toContainText('accepted revision 3')
    await capture(launched.app, 'whole-table-native-reopen-light')
    expect(errors).toEqual([])
    writeFileSync(
      join(artifacts, 'html-synthetic-journey.json'),
      JSON.stringify(
        {
          profile,
          projectId: project.id,
          workflowId: workflow.id,
          sourceRows: 205,
          sampleRows: 20,
          independentAmountSum: 961.25,
          acceptedRevision: 3,
          lastCode: '000204',
          literalFormulaPreserved: true,
          keyCorrectionBlocked: true,
          personalCorrectionRetained: true,
          sourceNoteChangeShown: true,
          truncatedRefreshPreservedAccepted: true,
          nativeReopenVerified: true,
          rendererErrors: errors,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'html-table-reopen')
  }
})

test('LIVE public table persona: capture all four official holiday tables in one request', async () => {
  test.skip(process.env.INFOMONK_LIVE_HTML !== '1', 'Opt-in public official HTTPS source request')
  test.setTimeout(180_000)
  let launched = await launchShell({ onboardingSeen: true, videoDir: 'html-holidays-live' })
  const errors: string[] = []
  let page = launched.page
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1450, 1000),
    )
    await launched.app.evaluate(() => {
      const original = globalThis.fetch
      ;(globalThis as unknown as { holidayRequests: number }).holidayRequests = 0
      globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
        if (String(args[0]).startsWith('https://www.gov.bm/public-holidays'))
          (globalThis as unknown as { holidayRequests: number }).holidayRequests++
        return original(...args)
      }) as typeof fetch
    })
    const project = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Bermuda official holiday tables',
        description: 'Primary government source; source dates and context notes; manual refresh',
        startKind: 'researchWeb',
      }),
    )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Research task', { exact: true }).selectOption('htmlTables')
    await page.getByLabel('Workflow name', { exact: true }).fill('Official holidays')
    await page
      .getByLabel('Public table URL', { exact: true })
      .fill('https://www.gov.bm/public-holidays')
    const started = Date.now()
    await page.getByRole('button', { name: 'Find tables on this page', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: '4 tables found · 40 source rows' }),
    ).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Select all supported tables', exact: true }).click()
    await page.getByRole('button', { name: 'Use first column as record key', exact: true }).click()
    await page
      .getByLabel('First row contains column names in selected tables', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(page.locator('.im-research-table')).toHaveCount(4)
    await expect(page.locator('.im-research-table tbody tr')).toHaveCount(40)
    await expect(page.locator('.im-source-context')).toContainText('Monday, 28th December 2026')
    const collectMs = Date.now() - started
    expect(
      await launched.app.evaluate(
        () => (globalThis as unknown as { holidayRequests: number }).holidayRequests,
      ),
    ).toBe(1)
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    await page.locator('.im-source-context').scrollIntoViewIfNeeded()
    await capture(launched.app, 'official-holidays-context-light')
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id),
      workflow = state.workflows[0]
    const destination = workflow.destination!,
      zip = await JSZip.loadAsync(readFileSync(destination)),
      metadata = JSON.parse(await zip.file('infomonk/research.json')!.async('string'))
    expect(metadata.dataset.tables.map((t: { rows: unknown[] }) => t.rows.length)).toEqual([
      10, 10, 10, 10,
    ])
    expect(metadata.dataset.tables.map((t: { name: string }) => t.name)).toEqual([
      '2026',
      '2027',
      '2028',
      '2029',
    ])
    expect(metadata.dataset.tables[0].rows[0].cells.column_2.value).toBe('Thursday, 1st January')
    expect(metadata.attribution).toContain('Captured public HTML')
    expect(await zip.file('xl/worksheets/sheet1.xml')!.async('string')).toContain('>Holiday</t>')
    await closeAndSaveVideo(launched, 'html-holidays-live')
    launched = await launchShell({
      userDataDir: launched.userDataDir,
      videoDir: 'html-holidays-reopen',
      openFile: destination,
    })
    page = launched.page
    const sheet = await waitForPageWithUrl(launched.app, '://sheets/')
    await expect(sheet.locator('main.app-shell')).toHaveAttribute('aria-busy', 'false')
    await sheet.locator('[data-u-comp="defined-name"] input').fill('B2')
    await sheet.locator('[data-u-comp="defined-name"] input').press('Enter')
    await sheet.getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(sheet.locator('.im-cell-evidence')).toContainText('Thursday, 1st January')
    await expect(sheet.locator('.im-cell-evidence')).toContainText('Date · accepted revision 1')
    await expect(sheet.locator('.im-cell-evidence')).toContainText('www.gov.bm/public-holidays')
    await sheet.getByRole('button', { name: 'Inspect snapshot', exact: true }).click()
    await expect(sheet.locator('.im-cell-evidence')).toContainText('Thursday, 1st January')
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await capture(launched.app, 'official-holidays-native-evidence-dark')
    mkdirSync(artifacts, { recursive: true })
    const output = resolve(__dirname, '../working_dir/Bermuda-Official-Holiday-Tables.xlsx')
    copyFileSync(destination, output)
    writeFileSync(
      join(artifacts, 'html-live-journey.json'),
      JSON.stringify(
        {
          profile: launched.userDataDir,
          projectId: project.id,
          workflowId: workflow.id,
          destination,
          output,
          url: 'https://www.gov.bm/public-holidays',
          sourceTables: 4,
          sourceRows: 40,
          rowsByYear: [10, 10, 10, 10],
          sourceContextNotes: 4,
          initialHttpRequests: 1,
          collectElapsedMs: collectMs,
          acceptedRevision: 1,
          nativeEvidenceVerified: true,
          restartVerified: true,
          rendererErrors: errors,
          limitations:
            'Static source dates remain text; no inferred substitute dates. Initial capture reuse measured; no exhaustive website or browser-table claim.',
        },
        null,
        2,
      ) + '\n',
    )
    expect(errors).toEqual([])
  } finally {
    await closeAndSaveVideo(launched, 'html-holidays-reopen')
  }
})
