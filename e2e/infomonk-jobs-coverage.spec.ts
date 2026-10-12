import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdirSync, writeFileSync, copyFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'
import { JOB_SITES, JOB_DISCOVERY_SITES } from '../apps/shell/src/shared/jobs-api'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'

declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}
const artifacts = resolve(__dirname, '../docs/testing/bermuda-coverage-2026-10-12')
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

test('LIVE expanded coverage: all supported public sources, coverage gaps, tracking, refresh and native reopen', async () => {
  test.skip(
    process.env.INFOMONK_COVERAGE_JOBS !== '1',
    'Explicit opt-in to all registered public source requests',
  )
  test.setTimeout(420_000)
  mkdirSync(resolve(__dirname, 'artifacts'), { recursive: true })
  const profile = mkdtempSync(resolve(__dirname, 'artifacts/bermuda-coverage-demo-'))
  let launched = await launchShell({
    userDataDir: profile,
    onboardingSeen: true,
    videoDir: 'jobs-wide-live',
  })
  const { page, app } = launched,
    errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 1000))
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    const project = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Bermuda jobs — expanded public search',
        description:
          'Technology, data and office; broad public sources; manual refresh; remaining coverage explicit',
        startKind: 'researchWeb',
      }),
    )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    const initialSheet = await waitForPageWithUrl(app, '://sheets/')
    await expect(initialSheet.locator('main.app-shell')).toHaveAttribute('aria-busy', 'false')
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Research task', { exact: true }).selectOption('jobs')
    await page
      .getByLabel('Workflow name', { exact: true })
      .fill('Bermuda jobs — broad source coverage')
    await page.getByRole('button', { name: 'Select all supported websites', exact: true }).click()
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    let state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    const workflow = state.workflows[0]
    expect(workflow.config.jobSiteIds).toHaveLength(JOB_SITES.length)
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.infomonkResearch.state(id), project.id)).runs[0]
            ?.status,
        { timeout: 220_000, intervals: [500, 1000] },
      )
      .toMatch(/^(review|failed|cancelled)$/)
    state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.runs[0], state.runs[0].error ?? state.runs[0].progress).toMatchObject({
      status: 'review',
    })
    expect(errors).toEqual([])
    await page.getByRole('button', { name: 'Review candidate', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Candidate — accepted data unchanged', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Review candidate', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Candidate — accepted data unchanged', exact: true }),
    ).toBeVisible()
    expect(state.runs[0].coverage).toEqual({
      total: JOB_SITES.length,
      complete: JOB_SITES.length,
      failed: 0,
    })
    const jobs = page
      .locator('.im-research-table')
      .filter({ has: page.getByRole('heading', { name: /^Jobs ·/ }) })
    const bi = jobs
      .locator('tbody tr')
      .filter({ hasText: 'Enterprise Governance and Compliance Analyst' })
    await page.getByRole('combobox', { name: /^Listing source/ }).selectOption('Ariel Re')
    await page.getByLabel('Search all listings', { exact: true }).fill('Enterprise Governance')
    await page.getByLabel('Search all listings', { exact: true }).press('Enter')
    await expect(bi).toBeVisible()
    await bi
      .getByRole('button', { name: 'Enterprise Governance and Compliance Analyst', exact: true })
      .click()
    await page.getByRole('button', { name: 'Verify snapshot and locator', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Enterprise Governance and Compliance Analyst' }),
    ).toBeVisible()
    const coverage = page
      .locator('.im-research-table')
      .filter({ has: page.getByRole('heading', { name: /^Source checks ·/ }) })
    await expect(
      coverage.locator('tbody tr').filter({ hasText: 'Bermuda Job Connect' }),
    ).toContainText('not collected')
    await coverage.scrollIntoViewIfNeeded()
    await capture(app, 'source-coverage-light')
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    await jobs.scrollIntoViewIfNeeded()
    await capture(app, 'wide-tracker-light')
    await bi.getByRole('button', { name: 'To review', exact: true }).click()
    await page.getByLabel('Corrected value', { exact: true }).selectOption('Saved')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill('Demonstration shortlist after reviewing primary metadata; no application sent')
    await page.getByRole('button', { name: 'Save tracking update', exact: true }).click()
    await bi.getByRole('button', { name: 'Add note', exact: true }).click()
    await page
      .getByLabel('Corrected value', { exact: true })
      .fill('Review primary employer requirements and availability; no application sent.')
    await page
      .getByLabel('Correction reason', { exact: true })
      .fill('Source metadata leaves these facts uncertain')
    await page.getByRole('button', { name: 'Save tracking update', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Refresh job listings', exact: true }).click()
    await expect
      .poll(
        async () =>
          (await page.evaluate((id) => window.infomonkResearch.state(id), project.id)).runs[0]
            ?.status,
        { timeout: 220_000, intervals: [500, 1000] },
      )
      .toMatch(/^(review|failed|cancelled)$/)
    state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.runs[0], state.runs[0].error ?? state.runs[0].progress).toMatchObject({
      status: 'review',
    })
    await page.getByRole('button', { name: 'Review candidate', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Candidate — accepted data unchanged', exact: true }),
    ).toBeVisible()
    await expect(bi).toContainText('Saved')
    await expect(bi).toContainText('Review primary employer requirements')
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 4', exact: true }),
    ).toBeVisible()
    const accepted = await page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w),
      [project.id, workflow.id],
    )
    const sources = accepted!.tables.find((t) => t.id === 'job_sources')!
    expect(sources.rows.filter((r) => r.cells.last_checked.value === null)).toHaveLength(
      JOB_DISCOVERY_SITES.length,
    )
    expect(
      sources.rows
        .filter((r) => r.cells.last_checked.value === null)
        .every((r) => r.cells.matched_rows.value === null),
    ).toBe(true)
    state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.workflows[0].scheduleMinutes).toBeNull()
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await jobs.scrollIntoViewIfNeeded()
    await capture(app, 'wide-tracker-refreshed-dark')
    const output = resolve(
      __dirname,
      '../working_dir/bermuda-jobs/Bermuda-Jobs-Tracker-Coverage.xlsx',
    )
    mkdirSync(resolve(__dirname, '../working_dir/bermuda-jobs'), { recursive: true })
    copyFileSync(state.workflows[0].destination!, output)
    await closeAndSaveVideo(launched, 'jobs-wide-live')
    launched = await launchShell({ userDataDir: profile, videoDir: 'jobs-wide-reopen' })
    launched.page.on('pageerror', (e) => errors.push(String(e)))
    const reopened = await launched.page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w),
      [project.id, workflow.id],
    )
    const totalRows = reopened!.tables[0].totalRows ?? reopened!.tables[0].rows.length
    for (let offset = 100; offset < totalRows; offset += 100) {
      const next = await launched.page.evaluate(
        ([p, w, o]) => window.infomonkResearch.accepted(p, w, { tableId: 'jobs', offset: o }),
        [project.id, workflow.id, offset] as const,
      )
      reopened!.tables[0].rows.push(...next!.tables[0].rows)
    }
    expect(reopened!.tables[0].rows).toHaveLength(totalRows)
    expect(new Set(reopened!.tables[0].rows.map((r) => r.cells.job_key.value)).size).toBe(totalRows)
    const currentRows = reopened!.tables[0].rows.filter(
      (r) => !/^(Not found|Outside selected)/i.test(String(r.cells.listing_status.value ?? '')),
    )
    expect(sources.rows.reduce((sum, r) => sum + Number(r.cells.matched_rows.value ?? 0), 0)).toBe(
      currentRows.length,
    )
    expect(
      reopened!.tables[0].rows.find((r) => r.cells.job_key.value === 'ariel:161')!.cells
        .application_status.value,
    ).toBe('Saved')
    await launched.page.evaluate(
      ([p, w]) => window.infomonkResearch.open(p, w),
      [project.id, workflow.id],
    )
    const sheet = await waitForPageWithUrl(launched.app, '://sheets/')
    sheet.on('pageerror', (e) => errors.push(String(e)))
    await expect(sheet.locator('main.app-shell')).toHaveAttribute('aria-busy', 'false')
    const index =
      reopened!.tables[0].rows.findIndex((r) => r.cells.job_key.value === 'ariel:161') + 2
    await sheet.locator('[data-u-comp="defined-name"] input').fill('B' + index)
    await sheet.locator('[data-u-comp="defined-name"] input').press('Enter')
    await sheet.getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(sheet.locator('.im-cell-evidence')).toContainText(
      'Enterprise Governance and Compliance Analyst',
    )
    await sheet.getByRole('button', { name: 'Inspect snapshot', exact: true }).first().click()
    await expect(sheet.locator('.im-cell-evidence pre')).toContainText(
      'Enterprise Governance and Compliance Analyst',
    )
    await capture(launched.app, 'wide-native-evidence-dark')
    const jsonIndex =
      reopened!.tables[0].rows.findIndex(
        (r) =>
          String(r.cells.job_key.value).startsWith('axis:') &&
          r.cells.title.value === 'Investment Operations Analyst',
      ) + 2
    expect(jsonIndex).toBeGreaterThan(1)
    await sheet.locator('[data-u-comp="defined-name"] input').fill('B' + jsonIndex)
    await sheet.locator('[data-u-comp="defined-name"] input').press('Enter')
    await expect(sheet.locator('.im-cell-evidence')).toContainText('Investment Operations Analyst')
    await sheet.getByRole('button', { name: 'Inspect snapshot', exact: true }).first().click()
    await expect(sheet.locator('.im-cell-evidence pre')).toContainText(
      'Investment Operations Analyst',
    )
    await capture(launched.app, 'wide-native-json-evidence-dark')
    expect(errors).toEqual([])
    writeFileSync(
      join(artifacts, 'live-results.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          profile,
          projectId: project.id,
          workflowId: workflow.id,
          acceptedRevision: 4,
          output,
          destination: state.workflows[0].destination,
          coverage: state.runs[0].coverage,
          sourceCount: JOB_SITES.length,
          uncollectedTargets: JOB_DISCOVERY_SITES.length,
          rendererErrors: errors,
          freshProcessReopen: true,
          nativeSheetEvidence: true,
          records: reopened!.tables[0].rows.map((r) =>
            Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, c.value])),
          ),
          sourceChecks: sources.rows.map((r) =>
            Object.fromEntries(Object.entries(r.cells).map(([k, c]) => [k, c.value])),
          ),
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'jobs-wide-live')
  }
})

test('attach expanded manual source research without changing accepted jobs', async () => {
  test.skip(
    process.env.INFOMONK_COVERAGE_ATTACH !== '1',
    'Opt-in to the saved isolated coverage demo',
  )
  const resultPath = join(artifacts, 'live-results.json')
  const live = JSON.parse(readFileSync(resultPath, 'utf8'))
  expect(
    resolve(live.profile).startsWith(resolve(__dirname, 'artifacts/bermuda-coverage-demo-')),
  ).toBe(true)
  let launched = await launchShell({
    userDataDir: live.profile,
    videoDir: 'jobs-coverage-research',
  })
  const paths = [
    resolve(__dirname, '../docs/use-cases/bermuda-coverage-2026-10-12.md'),
    resolve(__dirname, '../docs/use-cases/bermuda-source-discovery-2026-10-12.md'),
  ]
  try {
    const attached = []
    for (const path of paths) {
      const project = await launched.page.evaluate(
        async ([id, path]) => {
          const existing = (await window.infomonk.list()).find((p) => p.id === id)!
          const source = existing.workspace.sources.find((s) => s.uri === path)
          return source
            ? window.infomonk.updateSource(id, source.id, path)
            : window.infomonk.addSource(id, { path })
        },
        [live.projectId, path],
      )
      const source = project.workspace.sources.findLast((s) => s.uri === path)!
      expect(source.sha256).toMatch(/^[a-f\d]{64}$/)
      attached.push({ sourceId: source.id, name: source.name, sha256: source.sha256 })
    }
    await launched.page.reload()
    await launched.page
      .locator('.im-project-open')
      .filter({ hasText: 'Bermuda jobs — expanded public search' })
      .click()
    await launched.page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await launched.page.evaluate(() => window.aiOffice.setTheme('light'))
    await launched.page.getByRole('button', { name: /^Sources(?: · \d+)?$/ }).click()
    for (const source of attached)
      await expect(
        launched.page
          .locator('.im-source-row')
          .filter({ hasText: source.sha256!.slice(0, 16) })
          .getByText(source.name, { exact: true }),
      ).toBeVisible()
    await capture(launched.app, 'manual-research-sources-light')
    await closeAndSaveVideo(launched, 'jobs-coverage-research')
    launched = await launchShell({
      userDataDir: live.profile,
      videoDir: 'jobs-coverage-research-reopen',
    })
    const project = (await launched.page.evaluate(() => window.infomonk.list())).find(
      (p) => p.id === live.projectId,
    )!
    for (const source of attached)
      expect(
        project.workspace.sources.some(
          (s) => s.id === source.sourceId && s.sha256 === source.sha256,
        ),
      ).toBe(true)
    const state = await launched.page.evaluate(
      (id) => window.infomonkResearch.state(id),
      live.projectId,
    )
    expect(state.workflows.find((w) => w.id === live.workflowId)!.acceptedRevision).toBe(
      live.acceptedRevision,
    )
    const selected = await launched.page.evaluate(
      ([p, w]) =>
        window.infomonkResearch.accepted(p, w, {
          tableId: 'jobs',
          view: { tableId: 'jobs', query: 'ariel:161' },
        }),
      [live.projectId, live.workflowId],
    )
    expect(selected!.tables[0].totalRows).toBe(1)
    const all = await launched.page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w, { tableId: 'jobs' }),
      [live.projectId, live.workflowId],
    )
    expect(all!.tables[0].totalRows).toBe(live.records.length)
    expect(selected!.tables[0].rows).toHaveLength(1)
    expect(selected!.tables[0].rows[0].cells.application_status.value).toBe('Saved')
    live.manualResearchAttachments = {
      sources: attached,
      restartVerified: true,
      acceptedRevisionUnchanged: true,
      manualListingsNotSilentlyInserted: true,
    }
    writeFileSync(resultPath, JSON.stringify(live, null, 2) + '\n')
  } finally {
    await closeAndSaveVideo(launched, 'jobs-coverage-research')
  }
})
