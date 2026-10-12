import { test, expect, type ElectronApplication } from '@playwright/test'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { launchShell, closeAndSaveVideo } from './helpers'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'

declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}
const root = resolve(__dirname, '..')
const artifacts = resolve(root, 'docs/testing/ui-ux-2026-10-12')
const manifestPath = resolve(root, 'docs/testing/bermuda-coverage-2026-10-12/live-results.json')
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

test('UI: inspect persisted Bermuda coverage, filter a shortlist and return keyboard focus', async () => {
  test.skip(
    process.env.INFOMONK_UI_LIVE !== '1',
    'Requires the previously captured Bermuda demo profile; does not search the web again',
  )
  test.setTimeout(180_000)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    profile: string
    projectId: string
    workflowId: string
    acceptedRevision: number
    checkedAt: string
  }
  const source = resolve(manifest.profile)
  const allowed = resolve(root, 'e2e/artifacts') + sep
  expect(source.toLowerCase().startsWith(allowed.toLowerCase())).toBe(true)
  expect(existsSync(source)).toBe(true)
  const profile = mkdtempSync(join(allowed, 'ui-tracker-'))
  cpSync(source, profile, { recursive: true })
  const launched = await launchShell({ userDataDir: profile, videoDir: 'ui-tracker' })
  const { page, app } = launched
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(String(err)))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 1000))
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    const project = (await page.evaluate(() => window.infomonk.list())).find(
      (p) => p.id === manifest.projectId,
    )!
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    const workflow = state.workflows.find((w) => w.id === manifest.workflowId)!
    await page.getByRole('button', { name: workflow.name, exact: true }).click()
    await expect(
      page.getByRole('heading', {
        name: `Accepted revision ${manifest.acceptedRevision}`,
        exact: true,
      }),
    ).toBeVisible()
    const jobs = page.locator('.im-jobs-table')
    await expect(jobs.getByRole('heading', { name: /^Jobs · 137/ })).toBeVisible()
    await page.getByLabel('Show rows needing review', { exact: true }).check()
    await expect(jobs.getByRole('button', { name: 'All listings', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    await jobs.getByRole('button', { name: 'All listings', exact: true }).click()
    await expect(page.getByLabel('Show rows needing review', { exact: true })).not.toBeChecked()
    await expect(jobs.locator('.im-more-filters')).not.toHaveAttribute('open', '')
    await jobs.getByLabel('Listing source', { exact: true }).selectOption('Ariel Re')
    await expect(jobs.getByRole('status')).toContainText('Filters changed')
    await jobs.getByLabel('Search all listings', { exact: true }).fill('Enterprise Governance')
    await jobs.getByLabel('Search all listings', { exact: true }).press('Enter')
    await expect(jobs.locator('tbody tr')).toHaveCount(1)
    await expect(jobs).toContainText('configured publisher')
    await jobs.scrollIntoViewIfNeeded()
    await capture(app, 'tracker-light')
    const title = jobs.getByRole('button', {
      name: 'Enterprise Governance and Compliance Analyst',
      exact: true,
    })
    await title.focus()
    await title.press('Enter')
    const details = page.getByRole('region', { name: 'Cell details', exact: true })
    await expect(details).toBeFocused()
    await expect(details.getByRole('heading', { name: 'Role', exact: true })).toBeVisible()
    await expect(
      details.locator('.im-evidence-technical').filter({ hasText: 'Snapshot details' }),
    ).not.toHaveAttribute('open', '')
    await details.getByRole('button', { name: 'Verify snapshot and locator', exact: true }).click()
    await expect(details.getByRole('status')).toContainText('Enterprise Governance')
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await capture(app, 'evidence-dark')
    await details.getByRole('button', { name: 'Close cell details', exact: true }).click()
    await expect(title).toBeFocused()
    await jobs.getByRole('button', { name: 'Saved shortlist', exact: true }).click()
    await expect(
      jobs.getByRole('button', { name: 'Saved shortlist', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(jobs.locator('tbody tr')).toHaveCount(1)
    await expect(jobs.getByLabel('Tracking status', { exact: true })).toBeVisible()
    await jobs.getByLabel('Sort listings', { exact: true }).selectOption('title:asc')
    await jobs.getByRole('button', { name: 'Apply view', exact: true }).click()
    await expect(jobs).toContainText('Saved')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 800))
    await jobs.scrollIntoViewIfNeeded()
    expect(
      await page.locator('.im-main').evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true)
    await capture(app, 'tracker-narrow-dark')
    await jobs.getByRole('button', { name: 'All listings', exact: true }).click()
    const coverage = page.locator('.im-source-checks')
    await expect(coverage).toContainText('26 checked')
    await expect(coverage).toContainText('52 not checked')
    await coverage.getByLabel('Find a source', { exact: true }).fill('Job Connect')
    const unsearched = coverage.locator('tbody tr')
    await expect(unsearched).toHaveCount(1)
    await expect(unsearched.locator('td').nth(1)).toHaveText('Not checked')
    await unsearched.locator('summary').click()
    await expect(unsearched).toContainText('not collected')
    await coverage.getByLabel('Find a source', { exact: true }).fill('LinkedIn')
    const partial = coverage.locator('tbody tr')
    await expect(partial).toHaveCount(1)
    await expect(partial).toContainText('Partial check')
    await partial.locator('summary').click()
    await expect(partial).toContainText('60 returned public cards checked of 275')
    const inspect = partial.getByRole('button', { name: /^Inspect check evidence for/ })
    await inspect.click()
    await expect(details).toBeFocused()
    await expect(details).toContainText('PARTIAL')
    await details.getByRole('button', { name: 'Close cell details', exact: true }).click()
    await expect(inspect).toBeFocused()
    await partial.locator('summary').click()
    await coverage.getByRole('button', { name: 'Clear source search', exact: true }).click()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 1000))
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    await coverage.evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await capture(app, 'coverage-light')
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await capture(app, 'coverage-dark')
    const final = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(final.workflows.find((w) => w.id === workflow.id)?.acceptedRevision).toBe(
      manifest.acceptedRevision,
    )
    expect(errors).toEqual([])
    writeFileSync(
      join(artifacts, 'tracker-results.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          sourceResearchCheckedAt: manifest.checkedAt,
          profile,
          projectId: project.id,
          workflowId: workflow.id,
          acceptedRevision: manifest.acceptedRevision,
          persistedListings: 137,
          sourceTargets: 78,
          unchangedAcceptedRevision: true,
          focusReturn: true,
          themes: ['light', 'dark'],
          windowSizes: [
            [1450, 1000],
            [900, 800],
          ],
          rendererErrors: errors,
          limits:
            'Uses a copied closed demo profile from the prior live collection; no new job search, application or tracking write.',
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'ui-tracker')
  }
})
