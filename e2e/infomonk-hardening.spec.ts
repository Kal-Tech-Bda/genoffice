import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { launchShell, closeAndSaveVideo, waitForPageWithUrl } from './helpers'
import type { WorkspaceApi } from '../apps/shell/src/shared/workspace-api'
import type { ResearchApi } from '../apps/shell/src/shared/research-api'

declare global {
  interface Window {
    infomonk: WorkspaceApi
    infomonkResearch: ResearchApi
  }
}
async function capture(app: Awaited<ReturnType<typeof launchShell>>['app'], name: string) {
  const folder = resolve(__dirname, '../docs/testing/hardening-2026-10-10')
  mkdirSync(folder, { recursive: true })
  const png = await app.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const window = BrowserWindow.getAllWindows()[0]
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1800, height: 1200 },
    })
    const source = sources.find((source) => source.id === window.getMediaSourceId())
    if (!source) throw Error('Native window capture unavailable')
    return source.thumbnail.toPNG().toString('base64')
  })
  writeFileSync(join(folder, name + '.png'), Buffer.from(png, 'base64'))
}
async function quote(page: Awaited<ReturnType<typeof launchShell>>['page'], filePath: string) {
  const project = await page.evaluate(
    (filePath) =>
      window.infomonk.create({
        name: 'Hardening quotes',
        description: 'Synthetic local evidence',
        filePath,
      }),
    filePath,
  )
  const workflow = await page.evaluate(
    (project) =>
      window.infomonkResearch.save(project.id, 'Paged quotes', {
        kind: 'quotes',
        instructions: 'Extract synthetic labeled quote',
        sourceIds: project.workspace!.sources.map((s) => s.id),
        fields: ['quote_id', 'supplier', 'date', 'currency', 'total', 'country_code'],
        countries: [],
        fromYear: 2023,
        toYear: 2024,
      }),
    project,
  )
  const run = await page.evaluate(
    ([p, w]) => window.infomonkResearch.run(p, w, false),
    [project.id, workflow.id],
  )
  await expect
    .poll(
      async () =>
        (await page.evaluate((id) => window.infomonkResearch.state(id), project.id)).runs.find(
          (r) => r.id === run.id,
        )?.status,
    )
    .toBe('review')
  await page.evaluate(
    ([p, r]) => window.infomonkResearch.publish(p, r, true, false),
    [project.id, run.id],
  )
  return { project, workflow, run }
}

test('pages accepted rows and evidence, corrects beyond the first page and starts an independent template project', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'infomonk-native-paging-')),
    filePath = join(sandbox, 'quotes.txt')
  writeFileSync(
    filePath,
    [
      'Supplier Quote',
      'Quote ID: Q-205',
      'Supplier: Northwind Demo',
      'Date: 2026-09-01',
      'Currency: CAD',
      'Total: 125.50',
      'Country code: CAN',
      ...Array.from(
        { length: 205 },
        (_, i) => `Item ${i + 1} | Product ${i + 1} | ${i + 1} | 20.00`,
      ),
    ].join('\n'),
  )
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'infomonk-hardening' })
  const { page } = launched
  try {
    const { project, workflow } = await quote(page, filePath)
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByRole('button', { name: workflow.name, exact: true }).click()
    await page.getByRole('button', { name: 'Inspect accepted table', exact: true }).click()
    const items = page
      .locator('.im-research-table')
      .filter({ has: page.getByRole('heading', { name: 'Line items · 205 rows', exact: true }) })
    await expect(items.locator('tbody tr')).toHaveCount(100)
    await page.getByRole('button', { name: 'Next Line items rows', exact: true }).click()
    await expect(items.getByText('Product 151', { exact: true })).toBeVisible()
    await items
      .locator('tbody tr')
      .filter({ hasText: 'Product 151' })
      .getByRole('button', { name: '151', exact: true })
      .click()
    await page.getByRole('button', { name: 'Verify snapshot and locator', exact: true }).click()
    await expect(page.locator('.im-cell-inspector pre')).toContainText(
      'Item 151 | Product 151 | 151 | 20.00',
    )
    await page.getByLabel('Corrected value').fill('999')
    await page.getByLabel('Correction reason').fill('Synthetic reviewed quantity')
    await page.getByRole('button', { name: 'Save persistent correction', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Accepted revision 2', exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Next Line items rows', exact: true }).click()
    await expect(
      items
        .locator('tbody tr')
        .filter({ hasText: 'Product 151' })
        .getByRole('button', { name: /^999/ }),
    ).toBeVisible()
    await items.locator('tbody tr').filter({ hasText: 'Product 151' }).scrollIntoViewIfNeeded()
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
        ),
    )
    await capture(launched.app, 'paged-correction-light')
    await page.getByRole('button', { name: 'Next Line items rows', exact: true }).click()
    await expect(items.locator('tbody tr')).toHaveCount(5)
    await expect(
      page.getByRole('button', { name: 'Next Line items rows', exact: true }),
    ).toBeDisabled()
    await page
      .getByRole('button', { name: 'Start a new project from this workflow', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Project name', { exact: true }).fill('Independent template')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const created = await page.evaluate(async () =>
      (await window.infomonk.list()).find((p) => p.name === 'Independent template')!,
    )
    expect(created.workspace!.sources).toEqual([])
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), created.id)
    expect(state.runs).toEqual([])
    expect(state.workflows[0]).toMatchObject({
      acceptedRevision: 0,
      scheduleMinutes: null,
      destination: null,
      config: { sourceIds: [], countries: [] },
    })
    await page.evaluate(() => window.aiOffice.setTheme('dark'))
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Paged quotes', exact: true })).toBeVisible()
    await capture(launched.app, 'independent-template-dark')
  } finally {
    await closeAndSaveVideo(launched, 'infomonk-paging-and-template')
  }
})

test('restores a closed-profile backup and resolves source evidence in the actual reopened sheet', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'infomonk-native-restore-')),
    source = join(sandbox, 'source'),
    bundle = join(sandbox, 'backup'),
    restored = join(sandbox, 'restored')
  mkdirSync(source)
  let launched = await launchShell({
    userDataDir: source,
    onboardingSeen: true,
    videoDir: 'infomonk-hardening',
  })
  let closed = false
  try {
    const { project, workflow } = await quote(
      launched.page,
      resolve(__dirname, '../fixtures/infomonk/research/valid.txt'),
    )
    await closeAndSaveVideo(launched, 'infomonk-before-backup')
    closed = true
    for (const [mode, input, output] of [
      ['backup', source, bundle],
      ['restore', bundle, restored],
    ]) {
      execFileSync(
        process.execPath,
        [
          '--experimental-strip-types',
          resolve(__dirname, '../tools/workspace-backup.mjs'),
          mode,
          '--source',
          input,
          '--destination',
          output,
        ],
        { encoding: 'utf8' },
      )
      if (mode === 'backup') {
        const hidden = join(sandbox, 'source-unavailable')
        for (const path of [source, hidden]) {
          const part = relative(sandbox, resolve(path))
          if (!part || isAbsolute(part) || part.startsWith('..'))
            throw Error('Test move escaped sandbox')
        }
        renameSync(source, hidden)
      }
    }
    launched = await launchShell({
      userDataDir: restored,
      onboardingSeen: true,
      videoDir: 'infomonk-hardening',
    })
    closed = false
    const { page, app } = launched
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.workflows[0].destination!.startsWith(restored)).toBe(true)
    await page.evaluate(([p, w]) => window.infomonkResearch.open(p, w), [project.id, workflow.id])
    const sheet = await waitForPageWithUrl(app, '://sheets/')
    await expect(sheet.locator('main.app-shell')).toHaveAttribute('aria-busy', 'false')
    await sheet.locator('[data-u-comp="defined-name"] input').fill('E2')
    await sheet.locator('[data-u-comp="defined-name"] input').press('Enter')
    await sheet.getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(sheet.locator('.im-cell-evidence')).toContainText('Accepted value: 125.5')
    await sheet.getByRole('button', { name: 'Inspect snapshot', exact: true }).first().click()
    await expect(sheet.locator('.im-cell-evidence pre')).toContainText('Total: 125.50')
    await capture(app, 'restored-sheet-evidence-light')
  } finally {
    if (!closed) await closeAndSaveVideo(launched, 'infomonk-restored-native-evidence')
  }
})
