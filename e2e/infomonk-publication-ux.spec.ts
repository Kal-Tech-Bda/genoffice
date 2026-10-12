import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { RESEARCH_CHANNEL, type ResearchApi } from '../apps/shell/src/shared/research-api'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'
import { launchShell, closeAndSaveVideo } from './helpers'

declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}

async function reviewQuote() {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'publication-ux' })
  const { page } = launched
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    const project = await page.evaluate(
      (filePath) =>
        window.infomonk.create({
          name: 'Publication UX fixture',
          description: 'Isolated labeled supplier quote',
          filePath,
        }),
      resolve(__dirname, '../fixtures/infomonk/research/valid.txt'),
    )
    const workflow = await page.evaluate(
      (project) =>
        window.infomonkResearch.save(project.id, 'Reviewed quote', {
          kind: 'quotes',
          instructions: 'Extract the labeled synthetic quote',
          sourceIds: project.workspace!.sources.map((source) => source.id),
          fields: ['quote_id', 'supplier', 'date', 'currency', 'total', 'country_code'],
          countries: [],
          fromYear: 2025,
          toYear: 2026,
        }),
      project,
    )
    const run = await page.evaluate(
      ([p, w]) => window.infomonkResearch.run(p, w, false),
      [project.id, workflow.id],
    )
    await waitStatus(page, project.id, run.id, 'review')
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: workflow.name, exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Publication review', exact: true }),
    ).toBeVisible()
    return { launched, project, workflow, errors }
  } catch (error) {
    await closeAndSaveVideo(launched, 'publication-ux-setup')
    throw error
  }
}

async function waitStatus(page: Page, projectId: string, runId: string, status: string) {
  await expect
    .poll(
      () =>
        page.evaluate(
          async ([p, r]) => (await window.infomonkResearch.detail(p, r)).status,
          [projectId, runId],
        ),
      { timeout: 30_000 },
    )
    .toBe(status)
}

async function failFirstPublishedPreview(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }, channel) => {
    const handlers = (
      ipcMain as unknown as {
        _invokeHandlers: Map<
          string,
          (event: unknown, method: string, ...args: unknown[]) => unknown
        >
      }
    )._invokeHandlers
    const original = handlers.get(channel)
    if (!original) throw new Error('Research handler is unavailable')
    let failPreview = false
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, method: string, ...args: unknown[]) => {
      const value = await original(event, method, ...args)
      if (method === 'publish') failPreview = true
      else if (method === 'accepted' && failPreview) {
        failPreview = false
        throw new Error('Synthetic accepted preview response failed')
      }
      return value
    })
  }, RESEARCH_CHANNEL)
}

test('keyboard publication requires review and focuses the accepted table after saving', async () => {
  const { launched, project, workflow, errors } = await reviewQuote()
  const { page } = launched
  try {
    const publish = page.getByRole('button', { name: 'Publish accepted table', exact: true })
    await expect(publish).toBeDisabled()
    await expect(
      page.getByText('Review the table and check the review confirmation before publishing.', {
        exact: true,
      }),
    ).toBeVisible()
    const review = page.getByLabel('I reviewed missing facts, conflicts and validation issues', {
      exact: true,
    })
    await review.focus()
    await review.press('Space')
    await expect(publish).toBeEnabled()
    await publish.focus()
    await publish.press('Enter')
    await expect(
      page.getByRole('status').filter({ hasText: 'Accepted revision 1 published.' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeFocused()
    await expect(
      page.getByRole('button', { name: 'Open accepted workbook', exact: true }),
    ).toBeEnabled()
    const quotes = page.getByRole('table', { name: 'Quotes', exact: true })
    const reviewOnly = page.getByLabel('Show rows needing review', { exact: true })
    await reviewOnly.check()
    await expect(quotes.getByText('No rows match this view.', { exact: false })).toBeVisible()
    await reviewOnly.uncheck()
    await expect(quotes.getByRole('button', { name: 'Q-100', exact: true })).toBeVisible()
    const accepted = await page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w),
      [project.id, workflow.id],
    )
    expect(
      accepted!.tables.find((table) => table.id === 'quotes')!.rows[0].cells.quote_id.value,
    ).toBe('Q-100')
    expect(errors).toEqual([])
  } finally {
    await closeAndSaveVideo(launched, 'publication-ux-focus')
  }
})

test('a preview response failure preserves publication success and reloads without republishing', async () => {
  const { launched, project, workflow, errors } = await reviewQuote()
  const { page, app } = launched
  try {
    await failFirstPublishedPreview(app)
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Accepted revision 1 published.' }),
    ).toBeVisible()
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'The accepted table is saved, but its preview could not be loaded:' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Open accepted workbook', exact: true }),
    ).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Publish accepted table', exact: true }),
    ).toHaveCount(0)
    await page.getByRole('button', { name: 'Reload accepted preview', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeFocused()
    await expect(
      page.getByRole('button', { name: 'Reload accepted preview', exact: true }),
    ).toHaveCount(0)
    const state = await page.evaluate((p) => window.infomonkResearch.state(p), project.id)
    expect(state.workflows.find((w) => w.id === workflow.id)!.acceptedRevision).toBe(1)
    expect(state.runs.filter((run) => run.status === 'published')).toHaveLength(1)
    expect(errors).toEqual([])
  } finally {
    await closeAndSaveVideo(launched, 'publication-ux-preview-recovery')
  }
})

test('returning after a failed HTML refresh shows accepted data and explains fresh capture versus retry', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'infomonk-html-return-')), 'catalogue.html')
  writeFileSync(
    path,
    '<h2>Catalogue</h2><table><tr><th>Code</th><th>Description</th></tr><tr><td>A01</td><td>Original row</td></tr></table>',
  )
  const launched = await launchShell({
    onboardingSeen: true,
    videoDir: 'publication-ux-html-return',
  })
  const { page } = launched
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    const project = await page.evaluate(async (sourcePath) => {
      const created = await window.infomonk.create({
        name: 'Returning table persona',
        description: 'Synthetic HTML snapshot',
        startKind: 'researchWeb',
      })
      return window.infomonk.addSource(created.id, { path: sourcePath })
    }, path)
    const setup = await page.evaluate(async (project) => {
      const sourceId = project.workspace!.sources.find(
        (source) => source.name === 'catalogue.html',
      )!.id
      const discovery = await window.infomonkResearch.discoverTables(project.id, { sourceId })
      const workflow = await window.infomonkResearch.save(project.id, 'Maintained catalogue', {
        kind: 'htmlTables',
        instructions: 'Maintain every captured row',
        sourceIds: [],
        fields: [],
        countries: [],
        fromYear: 2025,
        toYear: 2026,
        htmlTables: {
          sourceId,
          captureId: discovery.captureId,
          selections: [
            {
              tableId: discovery.tables[0].id,
              keyColumns: ['column_1'],
              confirmFirstRowAsHeader: true,
            },
          ],
        },
      })
      const run = await window.infomonkResearch.run(project.id, workflow.id, false)
      return { sourceId, workflowId: workflow.id, runId: run.id }
    }, project)
    await waitStatus(page, project.id, setup.runId, 'review')
    await page.evaluate(
      ([p, r]) => window.infomonkResearch.publish(p, r, true, false),
      [project.id, setup.runId],
    )
    writeFileSync(
      path,
      '<h2>Catalogue</h2><table><tr><th>Code</th><th>Description</th></tr><tr><td>A01</td><td>Truncated row</td></tr>',
    )
    await page.evaluate(
      ({ projectId, sourceId, path }) => window.infomonk.updateSource(projectId, sourceId, path),
      { projectId: project.id, sourceId: setup.sourceId, path },
    )
    const failed = await page.evaluate(
      ([p, w]) => window.infomonkResearch.run(p, w, false),
      [project.id, setup.workflowId],
    )
    await waitStatus(page, project.id, failed.id, 'failed')
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Maintained catalogue', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.im-research-table')).toContainText('Original row')
    await expect(
      page.getByRole('status').filter({ hasText: 'The latest check did not publish.' }),
    ).toContainText('Retry durable inputs reuses the original captured page.')
    await expect(
      page.getByRole('button', { name: 'Refresh website tables', exact: true }),
    ).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Retry durable inputs', exact: true }),
    ).toBeEnabled()
    const card = page.locator('.im-workflow-cards article').filter({
      has: page.getByRole('button', { name: 'Maintained catalogue', exact: true }),
    })
    await card.getByRole('button', { name: 'Edit', exact: true }).click()
    await expect(page.getByLabel('Research task', { exact: true })).toBeDisabled()
    await expect(
      page.getByRole('region', { name: 'Accepted website table inputs', exact: true }),
    ).toContainText('Create a new workflow to change them.')
    await expect(page.getByLabel('Public table URL', { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Find tables on this page', exact: true }),
    ).toHaveCount(0)
    await page
      .getByLabel('Workflow instructions', { exact: true })
      .fill('Notes-only review after source update')
    await page.getByRole('button', { name: 'Save new configuration version', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    const updated = (
      await page.evaluate((p) => window.infomonkResearch.state(p), project.id)
    ).workflows.find((w) => w.id === setup.workflowId)!
    expect(updated.config.instructions).toBe('Notes-only review after source update')
    expect(updated.config.htmlTables!.sourceId).toBe(setup.sourceId)
    expect(updated.config.htmlTables!.selections[0].keyColumns).toEqual(['column_1'])
    expect(updated.acceptedRevision).toBe(1)
    await expect(page.locator('.im-research-table')).toContainText('Original row')
    expect(errors).toEqual([])
  } finally {
    await closeAndSaveVideo(launched, 'publication-ux-html-return')
  }
})

test('saved and applied views still filter accepted rows after UI publication', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'publication-ux-views' })
  const { page, app } = launched
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    await app.evaluate(() => {
      globalThis.fetch = (async (raw: unknown) => {
        const url = new URL(String(raw))
        if (url.origin !== 'https://onecomm.bamboohr.com')
          throw new Error('Unexpected publication-view fixture request')
        if (url.pathname === '/careers/list')
          return new Response(
            JSON.stringify({ result: [{ id: 1 }, { id: 2 }], meta: { totalCount: 2 } }),
            { headers: { 'content-type': 'application/json' } },
          )
        const id = Number(url.pathname.match(/^\/careers\/(\d+)\/detail$/)?.[1])
        if (![1, 2].includes(id)) throw new Error('Unexpected publication-view fixture detail')
        return new Response(
          JSON.stringify({
            result: {
              jobOpening: {
                jobOpeningName: id === 1 ? 'Saved Office Administrator' : 'Other Data Analyst',
                location: { city: 'Hamilton', addressCountry: 'Bermuda' },
                jobOpeningShareUrl: `https://onecomm.bamboohr.com/careers/${id}`,
                jobOpeningStatus: 'Open',
                datePosted: '2026-10-01',
              },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }) as typeof fetch
    })
    const setup = await page.evaluate(async () => {
      const project = await window.infomonk.create({
        name: 'Post-publication views',
        description: 'Synthetic two-listing fixture',
        startKind: 'researchWeb',
      })
      const workflow = await window.infomonkResearch.save(project.id, 'Filtered accepted tracker', {
        kind: 'jobs',
        instructions: 'Synthetic public feed only',
        sourceIds: [],
        fields: [],
        countries: [],
        fromYear: 2025,
        toYear: 2026,
        jobSiteIds: ['onecomm'],
      })
      const run = await window.infomonkResearch.run(project.id, workflow.id, false)
      return {
        projectId: project.id,
        projectName: project.name,
        workflowId: workflow.id,
        runId: run.id,
      }
    })
    await waitStatus(page, setup.projectId, setup.runId, 'review')
    const refreshed = await page.evaluate(async ({ projectId, workflowId, runId }) => {
      await window.infomonkResearch.publish(projectId, runId, true, false)
      const accepted = await window.infomonkResearch.accepted(projectId, workflowId)
      const row = accepted!.tables
        .find((table) => table.id === 'jobs')!
        .rows.find((row) => row.cells.job_key.value === 'onecomm:1')!
      await window.infomonkResearch.correct(
        projectId,
        workflowId,
        'jobs',
        row.id,
        'application_status',
        'Saved',
        'Synthetic personal shortlist',
      )
      return window.infomonkResearch.run(projectId, workflowId, false)
    }, setup)
    await waitStatus(page, setup.projectId, refreshed.id, 'review')
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: setup.projectName }).click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Filtered accepted tracker', exact: true }).click()
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeFocused()
    const jobs = page.locator('.im-jobs-table')
    await jobs.getByRole('button', { name: 'Saved shortlist', exact: true }).click()
    await expect(
      jobs.getByRole('heading', { name: 'Jobs · 1 of 2 rows', exact: true }),
    ).toBeVisible()
    await expect(jobs.locator('tbody tr')).toHaveCount(1)
    await expect(jobs).toContainText('Saved Office Administrator')
    await jobs.getByLabel('Tracking status', { exact: true }).selectOption('Applied')
    await jobs.getByRole('button', { name: 'Apply view', exact: true }).click()
    await expect(jobs.getByText('No rows match this view.', { exact: false })).toBeVisible()
    await jobs.getByRole('button', { name: 'All listings', exact: true }).click()
    await expect(jobs.locator('tbody tr')).toHaveCount(2)
    const accepted = await page.evaluate(
      ({ projectId, workflowId }) => window.infomonkResearch.accepted(projectId, workflowId),
      setup,
    )
    expect(accepted!.tables.find((table) => table.id === 'jobs')!.rows).toHaveLength(2)
    expect(errors).toEqual([])
  } finally {
    await closeAndSaveVideo(launched, 'publication-ux-views')
  }
})
