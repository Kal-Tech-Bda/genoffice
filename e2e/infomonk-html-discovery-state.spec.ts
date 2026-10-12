import { test, expect, type ElectronApplication } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { launchShell, closeAndSaveVideo } from './helpers'
import { RESEARCH_CHANNEL } from '../apps/shell/src/shared/research-api'

/** Delay real local discovery responses, leaving the actual service/parser and renderer intact. */
async function installDelay(app: ElectronApplication) {
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
    if (!original) throw new Error('Research IPC handler is not registered.')
    const fixture = {
      next: false,
      pending: [] as {
        value: unknown
        resolve: (value: unknown) => void
        reject: (error: Error) => void
      }[],
    }
    ;(globalThis as unknown as { __htmlDiscoveryFixture: typeof fixture }).__htmlDiscoveryFixture =
      fixture
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, method: string, ...args: unknown[]) => {
      const delayed = method === 'discoverTables' && fixture.next
      if (delayed) fixture.next = false
      const value = await original(event, method, ...args)
      if (!delayed) return value
      return new Promise((resolve, reject) => fixture.pending.push({ value, resolve, reject }))
    })
  }, RESEARCH_CHANNEL)
}
async function arm(app: ElectronApplication) {
  await app.evaluate(() => {
    ;(
      globalThis as unknown as { __htmlDiscoveryFixture: { next: boolean } }
    ).__htmlDiscoveryFixture.next = true
  })
}
async function pending(app: ElectronApplication) {
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as unknown as { __htmlDiscoveryFixture: { pending: unknown[] } })
            .__htmlDiscoveryFixture.pending.length,
      ),
    )
    .toBe(1)
}
async function release(app: ElectronApplication, fail = false) {
  await pending(app)
  await app.evaluate((_electron, failure) => {
    const pending = (
      globalThis as unknown as {
        __htmlDiscoveryFixture: {
          pending: {
            value: unknown
            resolve: (value: unknown) => void
            reject: (error: Error) => void
          }[]
        }
      }
    ).__htmlDiscoveryFixture.pending.shift()!
    if (failure) pending.reject(new Error('Synthetic discovery request failed.'))
    else pending.resolve(pending.value)
  }, fail)
}
const html = (rows: number) =>
  `<h2>Catalogue</h2><table><tr><th>Code</th><th>Description</th></tr>${Array.from({ length: rows }, (_, i) => `<tr><td>SKU-${i}</td><td>Item ${i}</td></tr>`).join('')}</table>`

test('HTML discovery retains current edits, ignores obsolete responses and invalidates changed snapshots', async () => {
  test.setTimeout(150_000)
  const artifacts = resolve(__dirname, 'artifacts')
  mkdirSync(artifacts, { recursive: true })
  const directory = mkdtempSync(join(artifacts, 'html-discovery-state-'))
  const sourcePath = join(directory, 'catalogue.html')
  writeFileSync(sourcePath, html(2))
  const launched = await launchShell({ onboardingSeen: true, videoDir: 'html-discovery-state' })
  const { app, page } = launched
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  try {
    const project = await page.evaluate(() =>
      window.infomonk.create({
        name: 'Discovery editor state',
        description: 'Synthetic source and delayed responses',
        startKind: 'researchWeb',
      }),
    )
    const added = await page.evaluate(({ id, path }) => window.infomonk.addSource(id, { path }), {
      id: project.id,
      path: sourcePath,
    })
    const sourceId = added.workspace!.sources[0].id
    await page.reload()
    await page.locator('.im-project-open').filter({ hasText: project.name }).click()
    await page.evaluate(() => window.aiOfficeTabs.activate('home'))
    await page.getByRole('button', { name: 'Workflows', exact: true }).click()
    await page.getByLabel('Research task', { exact: true }).selectOption('htmlTables')
    await page.getByLabel('Workflow name', { exact: true }).fill('First workflow')
    await page.getByLabel('Table source', { exact: true }).selectOption('file')
    await installDelay(app)
    const find = () => page.getByRole('button', { name: 'Find tables on this page', exact: true })
    const found = (rows: number) =>
      page.getByRole('status').filter({ hasText: `1 tables found · ${rows} source rows` })
    const card = (name: string) =>
      page
        .locator('.im-workflow-cards article')
        .filter({ has: page.getByRole('button', { name, exact: true }) })

    await arm(app)
    await find().click()
    await page
      .getByLabel('Workflow instructions', { exact: true })
      .fill('Latest instruction entered while discovery was pending')
    await release(app)
    await expect(found(2)).toBeVisible()
    await expect(page.getByLabel('Workflow instructions', { exact: true })).toHaveValue(
      'Latest instruction entered while discovery was pending',
    )
    await page.getByRole('button', { name: 'Select all supported tables', exact: true }).click()
    await page.getByRole('button', { name: 'Use first column as record key', exact: true }).click()
    await page.getByRole('button', { name: 'Save workflow', exact: true }).click()
    const first = (await page.evaluate((id) => window.infomonkResearch.state(id), project.id))
      .workflows[0]
    expect(first.config.instructions).toBe('Latest instruction entered while discovery was pending')
    await page.evaluate(
      ({ id, config }) =>
        window.infomonkResearch.save(id, 'Second workflow', {
          ...config,
          instructions: 'Independent second workflow instructions',
        }),
      { id: project.id, config: first.config },
    )
    await expect(card('Second workflow')).toBeVisible()

    await card('First workflow').getByRole('button', { name: 'Edit', exact: true }).click()
    await arm(app)
    await find().click()
    await page.getByLabel('Research task', { exact: true }).selectOption('quotes')
    await release(app)
    await expect(page.getByLabel('Research task', { exact: true })).toHaveValue('quotes')
    await expect(page.locator('.im-html-input')).toHaveCount(0)

    await page.getByLabel('Research task', { exact: true }).selectOption('htmlTables')
    await arm(app)
    await find().click()
    await card('Second workflow').getByRole('button', { name: 'Edit', exact: true }).click()
    await release(app)
    await expect(page.getByLabel('Workflow name', { exact: true })).toHaveValue('Second workflow')
    await expect(page.getByLabel('Workflow instructions', { exact: true })).toHaveValue(
      'Independent second workflow instructions',
    )
    await expect(page.locator('.im-html-table-choice')).toHaveCount(0)
    await find().click()
    await expect(found(2)).toBeVisible()
    await page.getByRole('button', { name: 'Select all supported tables', exact: true }).click()
    await page.getByRole('button', { name: 'Use first column as record key', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Save new configuration version', exact: true }),
    ).toBeEnabled()

    writeFileSync(sourcePath, html(3))
    await page.evaluate(
      ({ id, sourceId, path }) => window.infomonk.updateSource(id, sourceId, path),
      { id: project.id, sourceId, path: sourcePath },
    )
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.locator('.im-html-table-choice')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Save new configuration version', exact: true }),
    ).toBeDisabled()
    await arm(app)
    await find().click()
    await pending(app)
    writeFileSync(sourcePath, html(4))
    await page.evaluate(
      ({ id, sourceId, path }) => window.infomonk.updateSource(id, sourceId, path),
      { id: project.id, sourceId, path: sourcePath },
    )
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(find()).toBeEnabled()
    await release(app)
    await expect(page.locator('.im-html-table-choice')).toHaveCount(0)
    await find().click()
    await expect(found(4)).toBeVisible()
    await page.getByRole('button', { name: 'Select all supported tables', exact: true }).click()
    await page.getByRole('button', { name: 'Use first column as record key', exact: true }).click()
    await arm(app)
    await find().click()
    await release(app, true)
    await expect(page.getByRole('alert')).toContainText('Synthetic discovery request failed')
    await expect(page.locator('.im-html-table-choice')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Save new configuration version', exact: true }),
    ).toBeDisabled()
    const state = await page.evaluate((id) => window.infomonkResearch.state(id), project.id)
    expect(state.workflows).toHaveLength(2)
    expect(state.workflows.every((workflow) => workflow.acceptedRevision === 0)).toBe(true)
    expect(state.runs).toHaveLength(0)
    expect(errors).toEqual([])
    writeFileSync(
      join(artifacts, 'html-discovery-state-results.json'),
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          projectId: project.id,
          profile: launched.userDataDir,
          passed: true,
          synthetic: true,
          realLocalServiceAndParser: true,
          responseDelayOnly: true,
          checks: [
            'Pending discovery preserves latest instructions',
            'Unmounted task ignores its response',
            'Same-source workflow switching does not inherit prior discovery or overwrite instructions',
            'Snapshot SHA changes invalidate preview and selections',
            'Old-version pending response is ignored',
            'Failed rediscovery leaves no stale selectable capture',
            'No run or accepted revision is created by discovery',
          ],
          rendererErrors: errors,
        },
        null,
        2,
      ) + '\n',
    )
  } finally {
    await closeAndSaveVideo(launched, 'html-discovery-state')
  }
})
