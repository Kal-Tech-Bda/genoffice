import { test, expect } from '@playwright/test'
import { launchShell, closeAndSaveVideo } from './helpers'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'

declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}

test('tracking update restores focus when the edited listing leaves the saved view', async () => {
  test.setTimeout(120_000)
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'tracking-focus' })
  const { app, page } = launched
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    await app.evaluate(() => {
      globalThis.fetch = (async (raw: unknown) => {
        const url = new URL(String(raw))
        if (url.origin !== 'https://onecomm.bamboohr.com')
          throw new Error('Unexpected tracking-focus fixture request')
        let data: unknown
        if (url.pathname === '/careers/list') {
          data = { result: [{ id: 1 }, { id: 2 }], meta: { totalCount: 2 } }
        } else {
          const id = Number(url.pathname.match(/^\/careers\/(\d+)\/detail$/)?.[1])
          if (![1, 2].includes(id)) throw new Error('Unexpected tracking-focus fixture detail')
          data = {
            result: {
              jobOpening: {
                jobOpeningName: id === 1 ? 'Focus Office Administrator' : 'Focus Data Analyst',
                location: { city: 'Hamilton', addressCountry: 'Bermuda' },
                jobOpeningShareUrl: `https://onecomm.bamboohr.com/careers/${id}`,
                jobOpeningStatus: 'Open',
                datePosted: '2026-10-01',
              },
            },
          }
        }
        return new Response(JSON.stringify(data), {
          headers: { 'content-type': 'application/json' },
        })
      }) as typeof fetch
    })
    const setup = await page.evaluate(async () => {
      const project = await window.infomonk.create({
        name: 'Tracking focus regression',
        description: 'Isolated synthetic two-listing keyboard-focus check',
        startKind: 'researchWeb',
      })
      const workflow = await window.infomonkResearch.save(project.id, 'Two-row job tracker', {
        kind: 'jobs',
        instructions: 'Synthetic public-feed fixture only',
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
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ projectId, runId }) =>
              (await window.infomonkResearch.detail(projectId, runId)).status,
            setup,
          ),
        { timeout: 30_000 },
      )
      .toBe('review')
    const savedRowId = await page.evaluate(async ({ projectId, workflowId, runId }) => {
      await window.infomonkResearch.publish(projectId, runId, true, false)
      const accepted = await window.infomonkResearch.accepted(projectId, workflowId)
      const jobs = accepted?.tables.find((table) => table.id === 'jobs')
      const row = jobs?.rows.find((row) => row.cells.job_key.value === 'onecomm:1')
      if (!row || jobs?.rows.length !== 2) throw new Error('Two-row fixture was not accepted')
      await window.infomonkResearch.correct(
        projectId,
        workflowId,
        'jobs',
        row.id,
        'application_status',
        'Saved',
        'Synthetic shortlist setup',
      )
      return row.id
    }, setup)

    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: setup.projectName }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Two-row job tracker', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 2', exact: true }),
    ).toBeVisible()
    const jobs = page.locator('.im-jobs-table')
    await jobs.getByRole('button', { name: 'Saved shortlist', exact: true }).click()
    await expect(
      jobs.getByRole('heading', { name: 'Jobs · 1 of 2 rows', exact: true }),
    ).toBeVisible()
    const row = jobs.locator('tbody tr').filter({ hasText: 'Focus Office Administrator' })
    await row.getByRole('button', { name: /^Saved\b/ }).click()
    const inspector = page.locator('.im-cell-inspector')
    await expect(inspector).toBeFocused()
    await inspector.getByLabel('Corrected value', { exact: true }).selectOption('Applied')
    await inspector.getByRole('button', { name: 'Save tracking update', exact: true }).click()

    await expect(jobs.getByText('No rows match this view.', { exact: false })).toBeVisible()
    await expect(row).toHaveCount(0)
    await expect(inspector).toHaveCount(0)
    await expect(jobs.getByRole('button', { name: 'Saved shortlist', exact: true })).toBeEnabled()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 3', exact: true }),
    ).toBeFocused()
    const accepted = await page.evaluate(
      ({ projectId, workflowId }) => window.infomonkResearch.accepted(projectId, workflowId),
      setup,
    )
    const retained = accepted!.tables.find((table) => table.id === 'jobs')!
    expect(retained.totalRows ?? retained.rows.length).toBe(2)
    expect(retained.rows).toHaveLength(2)
    expect(retained.rows.find((row) => row.id === savedRowId)!.cells.application_status.value).toBe(
      'Applied',
    )
    expect(
      retained.rows.find((row) => row.cells.job_key.value === 'onecomm:2')!.cells.application_status
        .value,
    ).toBe('To review')
    expect(errors).toEqual([])
  } finally {
    await closeAndSaveVideo(launched, 'tracking-focus')
  }
})
