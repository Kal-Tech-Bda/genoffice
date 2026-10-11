import { test, expect, type ElectronApplication } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo } from './helpers'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'
declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}
const research = (name: string) => resolve(__dirname, '../fixtures/infomonk/research', name)
const readinessFile = (name: string) => resolve(__dirname, '../fixtures/infomonk/readiness', name)
const artifacts = resolve(__dirname, '../docs/testing/input-readiness-2026-10-11')
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
test('readiness repairs a mixed batch without publishing, preserves a diagnostic sample and exposes the reviewed candidate', async () => {
  test.setTimeout(120_000)
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'input-readiness' })
  const { page, app } = launched,
    errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  app.on('window', (p) => p.on('pageerror', (e) => errors.push(String(e))))
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1450, 1000))
    await page.evaluate(() => window.aiOffice.setTheme('light'))
    const duplicate = join(
      mkdtempSync(join(tmpdir(), 'infomonk-readiness-copy-')),
      'identical-copy.txt',
    )
    copyFileSync(research('valid.txt'), duplicate)
    const project = await page.evaluate(
      (path) =>
        window.infomonk.create({
          name: 'Readiness demo',
          description: 'Review synthetic files before full processing',
          startKind: 'extractFiles',
          filePath: path,
        }),
      research('valid.txt'),
    )
    for (const path of [
      research('missing.md'),
      research('conflict.txt'),
      readinessFile('missing-key.txt'),
      readinessFile('no-text-layer.pdf'),
      duplicate,
    ])
      await page.evaluate(
        ([id, path]) => window.infomonk.addSource(id, { path }),
        [project.id, path],
      )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: 'Readiness demo' }).click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Workflow name', { exact: true }).fill('Readiness quotes')
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    const workflow = (await page.evaluate((id) => window.infomonkResearch.state(id), project.id))
      .workflows[0]
    const panel = page.getByRole('region', { name: 'Input readiness', exact: true })
    await page.getByRole('button', { name: 'Run sample', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Candidate — accepted data unchanged', exact: true }),
    ).toBeVisible()
    const sample = (await page.evaluate((id) => window.infomonkResearch.state(id), project.id))
      .runs[0]
    await page.getByRole('button', { name: 'Check input readiness', exact: true }).click()
    await expect(panel).toContainText('6 selected snapshots · 5 unique inputs')
    await expect(panel).toContainText('3 need review · 2 blocked · 1 identical copies')
    await expect(panel.getByText('missing-key.txt · Blocked', { exact: true })).toBeVisible()
    await expect(panel.getByText('no-text-layer.pdf · Blocked', { exact: true })).toBeVisible()
    await expect(panel).toContainText('OCR is outside this extractor')
    await expect(panel).toContainText('Identical snapshot bytes to valid.txt')
    await panel
      .locator('article')
      .filter({ hasText: 'missing.md · Needs review' })
      .getByText('missing.md · Text line 4', { exact: true })
      .click()
    await expect(panel).toContainText('Date: 2026-02-31')
    await expect(
      page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }),
    ).toBeDisabled()
    const bypass = await page.evaluate(
      async ([p, w]) => {
        try {
          await window.infomonkResearch.run(p, w, false)
          return 'Unexpected run'
        } catch (e) {
          return String(e)
        }
      },
      [project.id, workflow.id],
    )
    expect(bypass).toContain('Input readiness blocks this full run')
    let state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.runs).toHaveLength(1)
    expect(state.runs[0].status).toBe('review')
    expect(state.workflows[0].acceptedRevision).toBe(0)
    await panel.scrollIntoViewIfNeeded()
    await capture(app, 'blocked-inputs-light')
    await page.getByRole('button', { name: /^Sources(?: · \d+)?$/ }).click()
    const sourceRow = page.locator('.im-source-row').filter({ hasText: 'missing-key.txt' })
    await choose(app, readinessFile('key-fixed.txt'))
    await sourceRow
      .getByRole('button', { name: 'Update snapshot: missing-key.txt', exact: true })
      .click()
    await expect(page.locator('.im-source-row').filter({ hasText: 'key-fixed.txt' })).toBeVisible()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Readiness quotes', exact: true }).click()
    await page.getByRole('button', { name: 'Edit confirmed inputs', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Check input readiness', exact: true }),
    ).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }),
    ).toBeDisabled()
    await page.getByLabel(/no-text-layer.pdf ·/).uncheck()
    await page.getByRole('button', { name: 'Save new configuration version', exact: true }).click()
    await page.getByRole('button', { name: 'Check input readiness', exact: true }).click()
    await expect(panel).toContainText('5 selected snapshots · 4 unique inputs')
    await expect(panel).toContainText('1 ready · 3 need review · 0 blocked · 1 identical copies')
    await expect(panel).toContainText('Quote ID: Q-300')
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await panel.scrollIntoViewIfNeeded()
    await capture(app, 'repaired-inputs-dark')
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    const quotes = page
      .locator('.im-research-table')
      .filter({ has: page.getByRole('heading', { name: /^Quotes ·/ }) })
    await expect(quotes.locator('tbody tr')).toHaveCount(3)
    await expect(quotes.locator('tbody tr').filter({ hasText: 'Q-300' })).toContainText('22')
    await expect(quotes.locator('tbody tr').filter({ hasText: 'Q-100' })).toContainText('Missing')
    await expect(quotes.locator('tbody tr').filter({ hasText: 'Q-200' })).toContainText('Missing')
    state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.runs.find((r) => r.id === sample.id)?.status).toBe('obsolete')
    expect(state.workflows[0].acceptedRevision).toBe(0)
    await page
      .getByLabel('I reviewed missing facts, conflicts and validation issues', { exact: true })
      .check()
    await page.getByRole('button', { name: 'Publish accepted table', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 1', exact: true }),
    ).toBeVisible()
    const accepted = await page.evaluate(
      ([p, w]) => window.infomonkResearch.accepted(p, w),
      [project.id, workflow.id],
    )
    expect(
      Object.fromEntries(
        accepted!.tables[0].rows.map((r) => [String(r.cells.quote_id.value), r.cells.total.value]),
      ),
    ).toEqual({ 'Q-100': null, 'Q-200': null, 'Q-300': 22 })
    expect(errors).toEqual([])
    writeFileSync(
      join(artifacts, 'journey.json'),
      JSON.stringify(
        {
          date: '2026-10-11',
          profile: launched.userDataDir,
          projectId: project.id,
          workflowId: workflow.id,
          rendererErrors: errors,
          checks: [
            'Readiness leaves diagnostic sample and accepted state unchanged',
            'Missing key and textless PDF block full IPC execution',
            'Duplicate bytes and conflicting business keys distinguished',
            'Exact invalid date excerpt visible',
            'Source update and explicit scope repair unblock execution',
            'Unsaved configuration cannot run/check',
            'Reviewed candidate preserves null totals and Q-300 total 22',
          ],
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'input-readiness')
  }
})

test('a source change invalidates displayed readiness and is checked again before full execution', async () => {
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'input-readiness' })
  const { page } = launched
  try {
    const project = await page.evaluate(
      (path) => window.infomonk.create({ name: 'Stale check', description: '', filePath: path }),
      research('valid.txt'),
    )
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: 'Stale check' }).click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    await page.getByRole('button', { name: 'Check input readiness', exact: true }).click()
    const panel = page.getByRole('region', { name: 'Input readiness', exact: true })
    await expect(panel).toContainText('1 ready')
    await page.evaluate(
      async ([p, path]) => {
        const project = (await window.infomonk.list()).find((x) => x.id === p)!
        await window.infomonk.updateSource(p, project.workspace!.sources[0].id, path)
      },
      [project.id, readinessFile('missing-key.txt')],
    )
    await expect(panel).toContainText('This check is outdated')
    await page.getByRole('button', { name: 'Run all confirmed inputs', exact: true }).click()
    await expect(panel).toContainText('1 blocked')
    await expect(panel).not.toContainText('This check is outdated')
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.runs).toEqual([])
    expect(state.workflows[0].acceptedRevision).toBe(0)
  } finally {
    await closeAndSaveVideo(launched, 'stale-input-readiness')
  }
})
