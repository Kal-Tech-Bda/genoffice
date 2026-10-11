import { test, expect, type ElectronApplication } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'
declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}
const artifacts = resolve(__dirname, '../docs/testing/bermuda-jobs-2026-10-11')
const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/infomonk/jobs/pages.json'), 'utf8'),
) as Record<string, string>
async function capture(app: ElectronApplication, name: string) {
  mkdirSync(artifacts, { recursive: true })
  const base64 = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const win = BrowserWindow.getAllWindows()[0],
      sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1800, height: 1200 },
      })
    const source = sources.find((s) => s.id === win.getMediaSourceId())
    if (!source) throw Error('Native capture unavailable')
    return source.thumbnail.toPNG().toString('base64')
  })
  writeFileSync(join(artifacts, name + '.png'), Buffer.from(base64, 'base64'))
}
test('jobs: review, shortlist, failure preservation, refresh, disappearance and restart', async () => {
  test.setTimeout(120_000)
  let launched = await launchShell({ onboardingSeen: true, videoDir: 'jobs-fixture' })
  let page = launched.page
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const profile = launched.userDataDir
  try {
    await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1450, 1000),
    )
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    await launched.app.evaluate(({ shell }, pages) => {
      const state = { pages, mode: 'first', opened: [] as string[] }
      ;(globalThis as unknown as { jobsFixture: typeof state }).jobsFixture = state
      globalThis.fetch = (async (url: unknown) => {
        const uri = String(url),
          state = (
            globalThis as unknown as {
              jobsFixture: { pages: Record<string, string>; mode: string }
            }
          ).jobsFixture
        if (state.mode === 'failure' && uri.includes('ApplyJobList'))
          throw Error('Source offline fixture')
        let html = state.pages[uri]
        if (!html) throw Error('Unconfirmed fixture request: ' + uri)
        if (state.mode === 'second')
          html = html
            .replace('Data Analyst', 'Systems Administrator')
            .replace('16 October 2026', '18 October 2026')
        return new Response(html, { headers: { 'content-type': 'text/html' } })
      }) as typeof fetch
      shell.openExternal = (async (url: string) => {
        ;(globalThis as unknown as { jobsFixture: { opened: string[] } }).jobsFixture.opened.push(
          url,
        )
      }) as typeof shell.openExternal
    }, fixture)
    const project = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Synthetic Bermuda job tracker',
        description: 'Technology, data and office roles; fixture verification',
        startKind: 'researchWeb',
      }),
    )
    await page.reload()
    await page
      .locator('.im-project-open')
      .filter({ hasText: 'Synthetic Bermuda job tracker' })
      .click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Research task', { exact: true }).selectOption('jobs')
    await page.getByLabel('Workflow name', { exact: true }).fill('Bermuda jobs')
    for (const name of ['Bermuda Monetary Authority', 'Coralisle Group', 'Expertise Group'])
      await page.getByLabel(new RegExp('^' + name + ' ·')).check()
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Run sample', exact: true }).click()
    const jobs = page
      .locator('.im-research-table')
      .filter({ has: page.getByRole('heading', { name: /^Jobs ·/ }) })
    await expect(jobs.locator('tbody tr')).toHaveCount(1)
    await expect(
      page.getByRole('button', { name: 'Publish accepted table', exact: true }),
    ).toBeDisabled()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(jobs.locator('tbody tr')).toHaveCount(4)
    const analyst = jobs.locator('tbody tr').filter({ hasText: 'Data Analyst' })
    await expect(analyst).toContainText('Missing')
    await analyst.getByRole('button', { name: 'Data Analyst', exact: true }).click()
    await page.getByRole('button', { name: 'Verify snapshot and locator', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Data Analyst' })).toBeVisible()
    await page.getByRole('button', { name: 'Open live listing', exact: true }).click()
    expect(
      await launched.app.evaluate(
        () => (globalThis as unknown as { jobsFixture: { opened: string[] } }).jobsFixture.opened,
      ),
    ).toEqual(['https://www.expertisegroup.com/available-jobs'])
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    await analyst.getByRole('button', { name: 'To review', exact: true }).click()
    await page.getByLabel('Corrected value', { exact: true }).selectOption('Saved')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill('Shortlist after reviewing requirements')
    await page.getByRole('button', { name: 'Save tracking update', exact: true }).click()
    await expect(analyst).toContainText('Saved')
    await analyst.getByRole('button', { name: 'Add note', exact: true }).click()
    await page
      .getByLabel('Corrected value', { exact: true })
      .fill('Check qualifications; no application sent')
    await page.getByLabel('Correction reason', { exact: true }).fill('Personal tracking note')
    await page.getByRole('button', { name: 'Save tracking update', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeVisible()
    await launched.app.evaluate(
      () =>
        ((globalThis as unknown as { jobsFixture: { mode: string } }).jobsFixture.mode = 'failure'),
    )
    await page.getByRole('button', { name: 'Refresh job listings', exact: true }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Source offline fixture' }),
    ).toBeVisible()
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    const workflow = state.workflows[0]
    expect(workflow.acceptedRevision).toBe(3)
    await launched.app.evaluate(
      () =>
        ((globalThis as unknown as { jobsFixture: { mode: string } }).jobsFixture.mode = 'second'),
    )
    await page.getByRole('button', { name: 'Refresh job listings', exact: true }).click()
    await expect(jobs.locator('tbody tr')).toHaveCount(5)
    await expect(analyst).toContainText('Not found in latest check')
    await expect(analyst).toContainText('Saved')
    await expect(analyst).toContainText('Check qualifications; no application sent')
    await expect(jobs.locator('tbody tr').filter({ hasText: 'Systems Analyst' })).toContainText(
      '2026-10-18',
    )
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 4', exact: true }),
    ).toBeVisible()
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await jobs.scrollIntoViewIfNeeded()
    await capture(launched.app, 'synthetic-refreshed-tracker-dark')
    await closeAndSaveVideo(launched, 'jobs-fixture')
    launched = await launchShell({ userDataDir: profile, videoDir: 'jobs-restart' })
    page = launched.page
    page.on('pageerror', (e) => errors.push(String(e)))
    await page
      .locator('.im-project-open')
      .filter({ hasText: 'Synthetic Bermuda job tracker' })
      .click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Bermuda jobs', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 4', exact: true }),
    ).toBeVisible()
    const accepted = await page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w),
      [project.id, workflow.id],
    )
    const retained = accepted!.tables[0].rows.find((r) => r.cells.title.value === 'Data Analyst')!
    expect(retained.cells.application_status.value).toBe('Saved')
    expect(retained.cells.notes.value).toBe('Check qualifications; no application sent')
    expect(retained.cells.listing_status.value).toContain('Not found in latest check')
    expect(errors).toEqual([])
    mkdirSync(artifacts, { recursive: true })
    writeFileSync(
      join(artifacts, 'synthetic-journey.json'),
      JSON.stringify(
        {
          profile,
          projectId: project.id,
          workflowId: workflow.id,
          acceptedRevision: 4,
          rendererErrors: errors,
          checks: [
            'Sample to full',
            'Three-source collection',
            'Missing facts and location conflicts',
            'Verified immutable evidence',
            'Safe live listing link',
            'Shortlist and note persistence',
            'Failed refresh preserves accepted revision',
            'Disappeared listing retained, not called closed',
            'Updated deadline',
            'Fresh-process reopen',
          ],
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'jobs-restart')
  }
})

test('LIVE Bermuda jobs: collect selected websites, review, save and manually refresh a durable tracker', async () => {
  test.skip(
    process.env.INFOMONK_LIVE_JOBS !== '1',
    'Opt in explicitly to real public career-site requests',
  )
  test.setTimeout(180_000)
  mkdirSync(resolve(__dirname, 'artifacts'), { recursive: true })
  const profile = mkdtempSync(resolve(__dirname, 'artifacts/bermuda-jobs-demo-'))
  let launched = await launchShell({
    userDataDir: profile,
    onboardingSeen: true,
    videoDir: 'bermuda-jobs-live',
  })
  const { page, app } = launched,
    errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 1000))
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    const project = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Bermuda jobs — technology, data and office',
        description: 'Primary career pages; manual refresh; checked 11 October 2026',
        startKind: 'researchWeb',
      }),
    )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Research task', { exact: true }).selectOption('jobs')
    await page
      .getByLabel('Workflow name', { exact: true })
      .fill('Bermuda technology, data and office jobs')
    for (const name of ['Bermuda Monetary Authority', 'Coralisle Group', 'Expertise Group'])
      await page.getByLabel(new RegExp('^' + name + ' ·')).check()
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    const jobs = page
      .locator('.im-research-table')
      .filter({ has: page.getByRole('heading', { name: /^Jobs ·/ }) })
    await expect(
      page.getByRole('heading', { name: 'Candidate — accepted data unchanged', exact: true }),
    ).toBeVisible({ timeout: 120_000 })
    let state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    const workflow = state.workflows[0]
    expect(state.runs[0].coverage).toEqual({ total: 3, complete: 3, failed: 0 })
    await expect(jobs.locator('tbody tr').filter({ hasText: 'Data Analyst' })).toBeVisible()
    await expect(
      jobs.locator('tbody tr').filter({ hasText: 'Systems Administrator' }),
    ).toBeVisible()
    await jobs
      .locator('tbody tr')
      .filter({ hasText: 'Data Analyst' })
      .getByRole('button', { name: 'Data Analyst', exact: true })
      .click()
    await page.getByRole('button', { name: 'Verify snapshot and locator', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Data Analyst' })).toBeVisible()
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    await jobs.scrollIntoViewIfNeeded()
    await capture(app, 'live-jobs-light')
    const analyst = jobs.locator('tbody tr').filter({ hasText: 'Data Analyst' })
    await analyst.getByRole('button', { name: 'To review', exact: true }).click()
    await page.getByLabel('Corrected value', { exact: true }).selectOption('Saved')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill('Demo shortlist for the data-role workflow; no application sent')
    await page.getByRole('button', { name: 'Save tracking update', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 2', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Refresh job listings', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Candidate — accepted data unchanged', exact: true }),
    ).toBeVisible({ timeout: 120_000 })
    await expect(analyst).toContainText('Saved')
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeVisible()
    const accepted = await page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w),
      [project.id, workflow.id],
    )
    state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.workflows[0].scheduleMinutes).toBeNull()
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await jobs.scrollIntoViewIfNeeded()
    await capture(app, 'live-jobs-refreshed-dark')
    expect(errors).toEqual([])
    const output = resolve(__dirname, '../working_dir/bermuda-jobs/Bermuda-Jobs-Tracker.xlsx')
    mkdirSync(resolve(__dirname, '../working_dir/bermuda-jobs'), { recursive: true })
    copyFileSync(state.workflows[0].destination!, output)
    const records = accepted!.tables[0].rows.map((r) =>
      Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, c.value])),
    )
    await closeAndSaveVideo(launched, 'bermuda-jobs-live')
    launched = await launchShell({ userDataDir: profile, videoDir: 'bermuda-jobs-live-reopened' })
    launched.page.on('pageerror', (e) => errors.push(String(e)))
    const reopened = await launched.page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w),
      [project.id, workflow.id],
    )
    expect(
      reopened!.tables[0].rows.find((r) => r.cells.title.value === 'Data Analyst')!.cells
        .application_status.value,
    ).toBe('Saved')
    await launched.page.evaluate(
      ([p, w]) => window.infomonkResearch.open(p, w),
      [project.id, workflow.id],
    )
    const sheet = await waitForPageWithUrl(launched.app, '://sheets/')
    sheet.on('pageerror', (e) => errors.push(String(e)))
    await expect(sheet.locator('main.app-shell')).toHaveAttribute('aria-busy', 'false')
    await sheet.locator('[data-u-comp="defined-name"] input').fill('B2')
    await sheet.locator('[data-u-comp="defined-name"] input').press('Enter')
    await sheet.getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(sheet.locator('.im-cell-evidence')).toContainText(String(records[0].title))
    await sheet.getByRole('button', { name: 'Inspect snapshot', exact: true }).first().click()
    await expect(sheet.locator('.im-cell-evidence pre')).toContainText(String(records[0].title))
    await capture(launched.app, 'live-native-sheet-evidence-dark')
    expect(errors).toEqual([])
    writeFileSync(
      join(artifacts, 'live-results.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          profile,
          projectId: project.id,
          workflowId: workflow.id,
          acceptedRevision: 3,
          output,
          destination: state.workflows[0].destination,
          coverage: state.runs[0].coverage,
          jobCount: records.length,
          rendererErrors: errors,
          freshProcessReopen: true,
          nativeSheetEvidence: true,
          records,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'bermuda-jobs-live')
  }
})
