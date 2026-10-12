import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { launchShell, closeAndSaveVideo } from './helpers'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'

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
    if (!source) throw new Error('Native capture unavailable')
    return source.thumbnail.toPNG().toString('base64')
  })
  writeFileSync(join(artifacts, name + '.png'), Buffer.from(png, 'base64'))
}

test('persona: find a cross-page shortlist, save a view, review only fact changes and reopen', async () => {
  test.setTimeout(240_000)
  let launched = await launchShell({ onboardingSeen: true, videoDir: 'persona-views' })
  let page = launched.page
  const profile = launched.userDataDir,
    errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1450, 1000),
    )
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    await launched.app.evaluate(() => {
      ;(globalThis as unknown as { viewFixtureMode: string }).viewFixtureMode = 'first'
      globalThis.fetch = (async (raw: unknown) => {
        const url = new URL(String(raw)),
          mode = (globalThis as unknown as { viewFixtureMode: string }).viewFixtureMode
        if (url.origin !== 'https://onecomm.bamboohr.com')
          throw new Error('Unexpected fixture request')
        const title = (i: number) =>
          i === 153
            ? 'Needle Data Specialist'
            : i === 164
              ? 'Needle Systems Specialist'
              : `Office Administrator ${String(i).padStart(3, '0')}`
        let data: unknown
        if (url.pathname === '/careers/list')
          data = {
            result: Array.from({ length: 205 }, (_, i) => ({ id: i + 1 })).filter(
              (r) => !(r.id === 205 && mode === 'changed'),
            ),
            meta: { totalCount: mode === 'changed' ? 204 : 205 },
            observation: mode,
          }
        else {
          const i = Number(url.pathname.match(/\/careers\/(\d+)\/detail$/)?.[1]) - 1
          if (!Number.isInteger(i) || i < 0 || i > 204) throw new Error('Unexpected fixture detail')
          data = {
            result: {
              jobOpening: {
                jobOpeningName: title(i),
                location: { city: 'Hamilton', addressCountry: 'Bermuda' },
                jobOpeningShareUrl: `https://onecomm.bamboohr.com/careers/${i + 1}`,
                jobOpeningStatus: 'Open',
                datePosted: i === 153 && mode === 'changed' ? '2026-10-02' : '2026-10-01',
              },
            },
            observation: mode,
          }
        }
        return new Response(JSON.stringify(data), {
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch
    })
    const project = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Sample Maya — faster job research',
        description: 'Synthetic 205-listing persona journey',
        startKind: 'researchWeb',
      }),
    )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Research task', { exact: true }).selectOption('jobs')
    await page.getByLabel('Workflow name', { exact: true }).fill('Maya job tracker')
    await page.getByLabel(/^One Communications ·/).check()
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    const jobs = page.locator('.im-jobs-table')
    await expect(jobs.getByRole('heading', { name: 'Jobs · 205 rows', exact: true })).toBeVisible({
      timeout: 60_000,
    })
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    const searchStart = Date.now()
    await jobs.getByLabel('Search all listings', { exact: true }).fill('Needle')
    await jobs.getByLabel('Search all listings', { exact: true }).press('Enter')
    await expect(jobs.locator('tbody tr')).toHaveCount(2)
    await expect(
      jobs.getByRole('heading', { name: 'Jobs · 2 of 205 rows', exact: true }),
    ).toBeVisible()
    const searchMs = Date.now() - searchStart
    const data = jobs.locator('tbody tr').filter({ hasText: 'Needle Data Specialist' })
    await data.getByRole('button', { name: 'Save to shortlist', exact: true }).click()
    await expect(data).toContainText('Saved')
    await jobs.getByRole('button', { name: 'Saved shortlist', exact: true }).click()
    await expect(jobs.locator('tbody tr')).toHaveCount(1)
    await jobs.locator('summary').filter({ hasText: 'Saved views' }).click()
    await jobs.getByLabel('View name', { exact: true }).fill('My shortlist')
    await jobs.getByRole('button', { name: 'Save as new view', exact: true }).click()
    await expect(
      jobs.getByRole('combobox', { name: 'Saved job view', exact: true }),
    ).not.toHaveValue('')
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id),
      workflow = state.workflows[0]
    expect(workflow.acceptedRevision).toBe(2)
    const view = (
      await page.evaluate(
        ([p, w]) => window.infomonkResearch.views(p, w),
        [project.id, workflow.id],
      )
    )[0]
    expect(view.name).toBe('My shortlist')
    await jobs.getByRole('button', { name: 'All listings', exact: true }).click()
    await expect(
      jobs.getByRole('heading', { name: 'Jobs · 205 of 205 rows', exact: true }),
    ).toBeVisible()
    await jobs.getByLabel('Search all listings', { exact: true }).fill('there-is-no-such-role')
    await jobs.getByLabel('Search all listings', { exact: true }).press('Enter')
    await expect(jobs.getByText('No rows match this view.', { exact: false })).toBeVisible()
    await jobs.getByRole('button', { name: 'All listings', exact: true }).click()
    await jobs.getByRole('button', { name: 'Technology & data', exact: true }).click()
    await expect(jobs.locator('tbody tr')).toHaveCount(2)
    await jobs.scrollIntoViewIfNeeded()
    await capture(launched.app, 'technology-data-view-light')
    await launched.app.evaluate(
      () =>
        ((globalThis as unknown as { viewFixtureMode: string }).viewFixtureMode = 'observations'),
    )
    await page.getByRole('button', { name: 'Refresh job listings', exact: true }).click()
    const summary = page.getByRole('region', { name: 'Job refresh summary', exact: true })
    await expect(summary).toContainText('0 fact changes', { timeout: 60_000 })
    await expect(summary).toContainText('205 unchanged')
    await expect(summary).toContainText('Personal tracking retained for 1 listings')
    await summary.getByRole('button', { name: 'Show refresh changes', exact: true }).click()
    await expect(jobs.getByText('No rows match this view.', { exact: false })).toBeVisible()
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeVisible()
    expect(
      (await page.evaluate(
        ([p, w]) => window.infomonkResearch.accepted(p, w),
        [project.id, workflow.id],
      ))!.tables[0].totalRows,
    ).toBe(205)
    await jobs.getByRole('button', { name: 'All listings', exact: true }).click()
    await launched.app.evaluate(
      () => ((globalThis as unknown as { viewFixtureMode: string }).viewFixtureMode = 'changed'),
    )
    await page.getByRole('button', { name: 'Refresh job listings', exact: true }).click()
    await expect(summary).toContainText('1 fact changes', { timeout: 60_000 })
    await expect(summary).toContainText('1 newly not found')
    await summary.getByRole('button', { name: 'Show refresh changes', exact: true }).click()
    await expect(jobs.locator('tbody tr')).toHaveCount(2)
    await expect(jobs).toContainText('posted_date')
    await jobs.getByRole('button', { name: 'Show all job fields', exact: true }).click()
    expect(
      await page.locator('.im-main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    await jobs
      .locator('tbody tr')
      .filter({ hasText: 'Needle Data Specialist' })
      .getByRole('button', { name: '2026-10-02', exact: true })
      .click()
    await expect(page.locator('.im-cell-inspector')).toContainText(
      'Previous accepted value: 2026-10-01',
    )
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await summary.scrollIntoViewIfNeeded()
    await capture(launched.app, 'fact-refresh-summary-dark')
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 4', exact: true }),
    ).toBeVisible()
    await closeAndSaveVideo(launched, 'persona-views')
    launched = await launchShell({ userDataDir: profile, videoDir: 'persona-views-reopen' })
    page = launched.page
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Maya job tracker', exact: true }).click()
    const reopenedJobs = page.locator('.im-jobs-table')
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 4', exact: true }),
    ).toBeVisible()
    await reopenedJobs.locator('summary').filter({ hasText: 'Saved views' }).click()
    await reopenedJobs
      .getByRole('combobox', { name: 'Saved job view', exact: true })
      .selectOption(view.id)
    await expect(reopenedJobs.locator('tbody tr')).toHaveCount(1)
    await expect(reopenedJobs).toContainText('Needle Data Specialist')
    await expect(reopenedJobs).toContainText('Saved')
    await reopenedJobs.getByRole('button', { name: 'Show all job fields', exact: true }).click()
    await expect(reopenedJobs).toContainText('2026-10-02')
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    await reopenedJobs.scrollIntoViewIfNeeded()
    await capture(launched.app, 'saved-shortlist-reopen-light')
    expect(errors).toEqual([])
    mkdirSync(artifacts, { recursive: true })
    writeFileSync(
      join(artifacts, 'views-journey.json'),
      JSON.stringify(
        {
          profile,
          projectId: project.id,
          workflowId: workflow.id,
          syntheticSourceListings: 205,
          matchingNeedleRoles: 2,
          searchActions: 2,
          searchElapsedMs: searchMs,
          shortlistActions: 1,
          shortlistRestoreActions: 2,
          unchangedRefreshFacts: 0,
          postedDateChanges: 1,
          newlyNotFound: 1,
          acceptedRevision: 4,
          rendererErrors: errors,
          allRecordsRetained: 205,
          savedViewSurvivesRestart: true,
          notes:
            'Times include Playwright interaction/assertion overhead; one synthetic run, not human usability measurement',
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'persona-views-reopen')
  }
})
