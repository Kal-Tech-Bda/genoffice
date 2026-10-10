import { test, expect } from '@playwright/test'
import { resolve } from 'node:path'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'
import { launchShell, closeAndSaveVideo } from './helpers'

declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}

async function acceptedQuote() {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'research-context' })
  const { page } = launched
  try {
    const project = await page.evaluate(
      (filePath) =>
        window.infomonk.create({
          name: 'Research context test',
          description: 'Synthetic quotes for workflow review regression checks',
          filePath,
        }),
      resolve(__dirname, '../fixtures/infomonk/research/valid.txt'),
    )
    const workflow = await page.evaluate(
      (project) =>
        window.infomonkResearch.save(project.id, 'Accepted quotes', {
          kind: 'quotes',
          instructions: 'Extract the labeled synthetic quote',
          sourceIds: project.workspace!.sources.map((source) => source.id),
          fields: ['quote_id', 'supplier', 'date', 'currency', 'total', 'country_code'],
          countries: [],
          fromYear: 2023,
          toYear: 2024,
        }),
      project,
    )
    const run = await page.evaluate(
      ([projectId, workflowId]) => window.infomonkResearch.run(projectId, workflowId, false),
      [project.id, workflow.id],
    )
    await expect
      .poll(async () => {
        const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
        return state.runs.find((r) => r.id === run.id)?.status
      })
      .toBe('review')
    await page.evaluate(
      ([projectId, runId]) => window.infomonkResearch.publish(projectId, runId, true, false),
      [project.id, run.id],
    )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: workflow.name, exact: true }).click()
    await page.getByRole('button', { name: 'Inspect accepted table', exact: true }).click()
    await page.locator('.im-research-table').first().getByRole('button', { name: '125.5' }).click()
    await expect(page.locator('.im-cell-inspector')).toBeVisible()
    return { launched, project, workflow }
  } catch (error) {
    await closeAndSaveVideo(launched, 'research-context-setup')
    throw error
  }
}

test('saving a new workflow clears the previous cell evidence and correction form', async () => {
  const { launched } = await acceptedQuote()
  const { page } = launched
  try {
    await page.getByLabel('Workflow schedule').selectOption('15')
    await page.getByRole('button', { name: 'Update schedule', exact: true }).click()
    await page.getByText('Create a research workflow', { exact: true }).click()
    await page.getByLabel('Workflow name').fill('Separate workflow')
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Separate workflow', exact: true }),
    ).toBeVisible()
    await expect(page.locator('.im-cell-inspector')).toHaveCount(0)
    await expect(page.getByLabel('Corrected value')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Accepted revision 1' })).toHaveCount(0)
    await expect(page.getByLabel('Workflow schedule')).toHaveValue('manual')
  } finally {
    await closeAndSaveVideo(launched, 'research-new-workflow-context')
  }
})

test('retrying cancelled durable inputs exposes the candidate from the accepted view', async () => {
  const { launched, project, workflow } = await acceptedQuote()
  const { page } = launched
  try {
    const run = await page.evaluate(
      ([projectId, workflowId]) => window.infomonkResearch.run(projectId, workflowId, false),
      [project.id, workflow.id],
    )
    await expect
      .poll(async () => {
        const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
        return state.runs.find((r) => r.id === run.id)?.status
      })
      .toBe('review')
    await page.getByRole('button', { name: /· full · review$/ }).click()
    await page.getByLabel('I reviewed missing facts, conflicts and validation issues').check()
    await page
      .getByLabel('Remove absent records after review (manual overrides are retained)')
      .check()
    await page.evaluate(
      ([projectId, runId]) => window.infomonkResearch.cancel(projectId, runId),
      [project.id, run.id],
    )
    await page.getByRole('button', { name: 'Inspect accepted table', exact: true }).click()
    await page.locator('.im-research-table').first().getByRole('button', { name: '125.5' }).click()
    await page.getByRole('button', { name: 'Retry durable inputs', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Candidate — accepted data unchanged', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Accepted revision 1' })).toHaveCount(0)
    await expect(page.locator('.im-cell-inspector')).toHaveCount(0)
    await expect(
      page.getByLabel('I reviewed missing facts, conflicts and validation issues'),
    ).not.toBeChecked()
    await expect(
      page.getByLabel('Remove absent records after review (manual overrides are retained)'),
    ).not.toBeChecked()
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.workflows.find((w) => w.id === workflow.id)?.acceptedRevision).toBe(1)
  } finally {
    await closeAndSaveVideo(launched, 'research-retry-context')
  }
})
