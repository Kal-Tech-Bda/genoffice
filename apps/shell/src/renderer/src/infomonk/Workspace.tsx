import { useEffect, useRef, useState } from 'react'
import { Home } from '../Home'
import { SettingsModal } from '../SettingsModal'
import type { AccountStatus } from '../../../shared/home-api'
import type { WorkspaceApi, WorkspaceProject } from '../../../shared/workspace-api'
import { CleanupFlow } from './CleanupFlow'
import { ProjectCreator } from './ProjectCreator'
import { mt, type MonkString } from './en'
import { MonkMark } from './Mark'
import { ResearchPanel } from './ResearchPanel'
import type { ResearchOverview } from '../../../shared/research-api'
import './workspace.css'

declare global {
  interface Window {
    infomonk: WorkspaceApi
  }
}
type Section =
  | 'home'
  | 'projects'
  | 'connections'
  | 'localFiles'
  | 'sheets'
  | 'sources'
  | 'workflows'
  | 'outputs'
  | 'activity'
  | 'cleanup'
const projectSections = ['sheets', 'sources', 'workflows', 'outputs', 'activity'] as const
const emptyOverview: ResearchOverview = { outputCount: 0, outputs: [], activity: [] }
const icons: Partial<Record<Section, string>> = {
  home: '⌂',
  projects: '▤',
  connections: '↗',
  localFiles: '▱',
  sheets: '▦',
  sources: '▧',
  workflows: '↻',
  outputs: '↗',
  activity: '◷',
}
export function Workspace({
  homeActive,
  activeFile,
}: {
  homeActive: boolean
  activeFile?: string
}) {
  const [projects, setProjects] = useState<WorkspaceProject[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('home')
  const [creator, setCreator] = useState(false)
  const [template, setTemplate] = useState<{ projectId: string; workflowId: string } | undefined>()
  const [startKind, setStartKind] = useState<
    'general' | 'extractFiles' | 'researchWeb' | 'workSpreadsheet'
  >('general')
  const [selection, setSelection] = useState<
    { workflowId: string; runId: string | null; needsReview?: boolean } | undefined
  >()
  const [overviewState, setOverviewState] = useState<{
    projectId: string
    section: Section
    status: 'loading' | 'ready' | 'failed'
    data: ResearchOverview | null
  } | null>(null)
  const [overviewReload, setOverviewReload] = useState(0)
  const [exportNotice, setExportNotice] = useState<{
    projectId: string
    text: string
  } | null>(null)
  const [exporting, setExporting] = useState<number | null>(null)
  const exportRequest = useRef(0)
  const route = useRef({ projectId, section, homeActive })
  route.current = { projectId, section, homeActive }
  const [search, setSearch] = useState('')
  const [starred, setStarred] = useState(false)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [sort, setSort] = useState('recent')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [settings, setSettings] = useState(false)
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [link, setLink] = useState('')
  const [editing, setEditing] = useState<'name' | 'description' | null>(null)
  const [editValue, setEditValue] = useState('')
  const project = projects.find((item) => item.id === projectId)
  const metadata = project?.workspace
  const editorWorkspaceVisible = Boolean(project) && !homeActive
  const isProjectSection =
    projectSections.includes(section as (typeof projectSections)[number]) || section === 'cleanup'
  const currentOverview =
    homeActive && overviewState?.projectId === projectId && overviewState.section === section
      ? overviewState
      : null
  const overview = currentOverview?.data ?? emptyOverview
  async function refresh() {
    setProjects(await window.infomonk.list())
  }
  function changed(next: WorkspaceProject) {
    setProjects((current) => [next, ...current.filter((item) => item.id !== next.id)])
  }
  async function run(action: () => Promise<void>) {
    setError('')
    setBusy(true)
    try {
      await action()
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void refresh().catch((err) => setError(String(err)))
    const onFocus = () => {
      void refresh().catch((err) => setError(String(err)))
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  useEffect(() => {
    let live = true
    if (activeFile && !homeActive) {
      const owner = projects.find(
        (item) =>
          item.files.some((file) => file.toLowerCase() === activeFile.toLowerCase()) ||
          (item.workspace &&
            activeFile
              .toLowerCase()
              .startsWith(item.workspace.primaryWorkbook.replace(/[^\\/]+$/, '').toLowerCase())),
      )
      if (owner) {
        setProjectId(owner.id)
        setSection(
          /[\\/]workspace[\\/](?:research[\\/])?(?:previews|sources)[\\/]/i.test(activeFile)
            ? 'sources'
            : /\.xlsx$/i.test(activeFile)
              ? 'sheets'
              : 'outputs',
        )
      } else setProjectId(null)
      if (
        owner &&
        /\.xlsx$/i.test(activeFile) &&
        !/[\\/]workspace[\\/](?:research[\\/])?(?:previews|sources)[\\/]/i.test(activeFile) &&
        owner.workspace?.workingWorkbook !== activeFile
      )
        void window.infomonk
          .rememberWorkbook(owner.id, activeFile)
          .then((next) => {
            if (live)
              setProjects((current) => [next, ...current.filter((item) => item.id !== next.id)])
          })
          .catch((err) => {
            if (live) setError(String(err))
          })
    }
    return () => {
      live = false
    }
  }, [activeFile, projects, homeActive])
  useEffect(() => {
    void window.infomonk
      .layout(editorWorkspaceVisible ? 224 : 0, editorWorkspaceVisible ? 56 : 0)
      .catch((err) => setError(String(err)))
  }, [editorWorkspaceVisible])
  useEffect(() => {
    let live = true
    if (!projectId || !homeActive || !['outputs', 'activity'].includes(section)) {
      setOverviewState(null)
      return
    }
    const current = () =>
      live &&
      route.current.projectId === projectId &&
      route.current.section === section &&
      route.current.homeActive
    setOverviewState({ projectId, section, status: 'loading', data: null })
    void window.infomonkResearch
      .overview(projectId)
      .then((value) => {
        if (current()) setOverviewState({ projectId, section, status: 'ready', data: value })
      })
      .catch((err) => {
        if (current()) {
          setOverviewState({ projectId, section, status: 'failed', data: null })
          setError(String(err))
        }
      })
    return () => {
      live = false
    }
  }, [projectId, homeActive, section, overviewReload])
  useEffect(() => {
    const requests = exportRequest
    requests.current++
    setExportNotice(null)
    setExporting(null)
    return () => {
      requests.current++
    }
  }, [projectId, homeActive, section])
  function clearExportOutcome() {
    exportRequest.current++
    setExportNotice(null)
    setExporting(null)
  }
  async function exportAccepted(output: ResearchOverview['outputs'][number]) {
    if (!project) return
    const id = project.id
    const request = ++exportRequest.current
    const current = () =>
      request === exportRequest.current &&
      route.current.projectId === id &&
      route.current.section === 'outputs' &&
      route.current.homeActive
    setExportNotice(null)
    setError('')
    setExporting(request)
    try {
      const exported = await window.infomonkResearch.exportAccepted(
        id,
        output.workflowId,
        output.revision,
      )
      if (exported && current())
        setExportNotice({
          projectId: id,
          text: `${output.name} revision ${output.revision} exported from accepted data.`,
        })
    } catch (err) {
      if (current()) setError(String(err))
    } finally {
      setExporting((value) => (value === request ? null : value))
    }
  }
  async function navigate(
    next: Section,
    requestedSelection?: { workflowId: string; runId: string | null; needsReview?: boolean },
  ) {
    clearExportOutcome()
    setOverviewState(null)
    if (next === 'outputs' || next === 'activity') setOverviewReload((value) => value + 1)
    setSection(next)
    setError('')
    setEditing(null)
    setSelection(requestedSelection)
    if (next === 'sheets' && project) await window.infomonk.open(project.id)
    else {
      await window.aiOfficeTabs.activate('home')
      await refresh()
    }
  }
  async function openProject(item: WorkspaceProject) {
    clearExportOutcome()
    setProjectId(item.id)
    setSection('sheets')
    await window.infomonk.open(item.id)
  }
  async function newProject(kind: typeof startKind = 'general') {
    clearExportOutcome()
    await window.aiOfficeTabs.activate('home')
    setTemplate(undefined)
    setStartKind(kind)
    setCreator(true)
  }
  const visible = projects
    .filter(
      (item) =>
        (!starred || item.workspace?.starred) &&
        (!reviewOnly ||
          !!item.research?.pendingReviews ||
          !!item.research?.unresolvedCells ||
          !!item.research?.inputsChanged) &&
        `${item.name} ${item.workspace?.description}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt),
    )
  async function addFile() {
    const path = await window.infomonk.pickFile()
    if (path && project) changed(await window.infomonk.addSource(project.id, { path }))
  }
  async function updateSource(sourceId: string) {
    if (!project) return
    const path = await window.infomonk.pickFile()
    if (path) changed(await window.infomonk.updateSource(project.id, sourceId, path))
  }
  async function showSettings() {
    await window.aiOfficeTabs.activate('home')
    setStatus(await window.aiOffice.accountStatus())
    setSettings(true)
  }
  const outputFolder = metadata?.primaryWorkbook.replace(/[^\\/]+$/, '')
  const newOutput = (kind: 'doc' | 'slide' | 'markdown' | 'html' | 'pdf') =>
    run(async () => {
      const opts = outputFolder ? { dir: outputFolder } : undefined
      const methods = {
        doc: window.aiOffice.newDoc,
        slide: window.aiOffice.newSlide,
        markdown: window.aiOffice.newMarkdown,
        html: window.aiOffice.newHtml,
        pdf: window.aiOffice.newPdf,
      }
      await methods[kind](opts)
    })
  return (
    <div className={`im-workspace ${!homeActive ? 'im-editor-active' : ''}`}>
      <aside className="im-sidebar">
        <button className="im-wordmark" onClick={() => void run(() => navigate('home'))}>
          <MonkMark />
          <strong>Infomonk</strong>
        </button>
        <nav aria-label="Workspace">
          {(['home', 'projects'] as const).map((key) => (
            <button
              className={section === key && homeActive ? 'selected' : ''}
              title={mt(key)}
              aria-label={mt(key)}
              key={key}
              onClick={() => void run(() => navigate(key))}
            >
              <span aria-hidden="true">{icons[key]}</span>
              <span>{mt(key)}</span>
            </button>
          ))}
        </nav>
        {project && (
          <div className="im-project-nav">
            <div className="im-project-caption">
              <span>{project.name}</span>
              <button
                title={mt('rename')}
                aria-label={mt('rename')}
                onClick={() =>
                  void run(async () => {
                    await window.aiOfficeTabs.activate('home')
                    setEditing('name')
                    setEditValue(project.name)
                  })
                }
              >
                ···
              </button>
            </div>
            <nav aria-label={project.name}>
              {projectSections.map((key) => (
                <button
                  key={key}
                  title={mt(key)}
                  aria-label={mt(key)}
                  className={
                    section === key || (key === 'sheets' && section === 'cleanup') ? 'selected' : ''
                  }
                  onClick={() => void run(() => navigate(key))}
                >
                  <span aria-hidden="true">{icons[key]}</span>
                  <span>
                    {mt(key)}
                    {key === 'sources' && metadata?.sources.length
                      ? ` · ${metadata.sources.length}`
                      : ''}
                  </span>
                </button>
              ))}
            </nav>
          </div>
        )}
        <div className="im-sidebar-footer">
          <button
            title={mt('connections')}
            aria-label={mt('connections')}
            onClick={() => void run(() => navigate('connections'))}
          >
            <span aria-hidden="true">↗</span>
            <span>{mt('connections')}</span>
          </button>
          <button
            title={mt('localFiles')}
            aria-label={mt('localFiles')}
            onClick={() => void run(() => navigate('localFiles'))}
          >
            <span aria-hidden="true">▱</span>
            <span>{mt('localFiles')}</span>
          </button>
          <div className="im-footer-actions">
            <button
              title={mt('settings')}
              aria-label={mt('settings')}
              onClick={() => void run(showSettings)}
            >
              <span className="im-footer-icon" aria-hidden="true">
                ⚙
              </span>
              <span>{mt('settings')}</span>
            </button>
            <button
              title={mt('help')}
              aria-label={mt('help')}
              onClick={() =>
                void run(async () => {
                  await window.aiOffice.openHelp()
                })
              }
            >
              <span className="im-footer-icon" aria-hidden="true">
                ?
              </span>
              <span>{mt('help')}</span>
            </button>
          </div>
          <small>{mt('localWorkspace')}</small>
        </div>
      </aside>
      {!homeActive && project && (
        <header className="im-project-toolbar">
          <span className="im-toolbar-project">{project.name}</span>
          <button disabled={busy} onClick={() => void run(() => navigate('sources'))}>
            {mt('addSources')}
          </button>
          <button onClick={() => void run(() => navigate('workflows'))}>{mt('refresh')}</button>
          <button
            disabled={!!activeFile && activeFile !== metadata?.primaryWorkbook}
            title="Clean table operates on the saved primary project workbook"
            onClick={() => void run(() => navigate('cleanup'))}
          >
            {mt('cleanTable')}
          </button>
          <button onClick={() => void run(() => navigate('outputs'))}>{mt('create')}</button>
          <button
            title="Exports the saved workbook file. Save spreadsheet edits first; accepted ledger exports are available in Outputs."
            onClick={() =>
              void run(async () => {
                await window.infomonk.exportWorkbook(
                  project.id,
                  activeFile && /\.xlsx$/i.test(activeFile) ? activeFile : undefined,
                )
              })
            }
          >
            {mt('export')}
          </button>
        </header>
      )}
      {homeActive && (
        <main className="im-main">
          {error && (
            <div className="im-error" role="alert">
              {error}
              <button onClick={() => setError('')} aria-label={mt('close')}>
                ×
              </button>
            </div>
          )}
          {(section === 'home' || section === 'projects') && (
            <>
              <header className={section === 'home' ? 'im-home-hero' : 'im-list-heading'}>
                <div>
                  <p className="im-eyebrow">INFOMONK</p>
                  <h1>{section === 'home' ? mt('question') : mt('allProjects')}</h1>
                  {section === 'home' && <p>{mt('introduction')}</p>}
                </div>
                <button className="im-primary" onClick={() => void run(newProject)}>
                  + {mt('newProject')}
                </button>
              </header>
              {section === 'home' && (
                <div className="im-starts">
                  {(['researchWeb', 'extractFiles', 'workSpreadsheet'] as const).map(
                    (key, index) => (
                      <button key={key} onClick={() => void run(() => newProject(key))}>
                        <span aria-hidden="true">{['↗', '▧', '▦'][index]}</span>
                        {mt(key)}
                      </button>
                    ),
                  )}
                </div>
              )}
              <div className="im-heading">
                <h2>{section === 'home' ? mt('recentProjects') : mt('allProjects')}</h2>
                <div className="im-controls">
                  <input
                    aria-label={mt('search')}
                    placeholder={mt('search')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <button
                    className={starred ? 'selected' : ''}
                    aria-pressed={starred}
                    onClick={() => setStarred((value) => !value)}
                  >
                    ☆ {mt('starred')}
                  </button>
                  <button
                    aria-pressed={reviewOnly}
                    className={reviewOnly ? 'selected' : ''}
                    onClick={() => setReviewOnly((value) => !value)}
                  >
                    {mt('needsReview')}
                  </button>
                  <select
                    aria-label="Project sort"
                    value={sort}
                    onChange={(event) => setSort(event.target.value)}
                  >
                    <option value="recent">{mt('newest')}</option>
                    <option value="name">{mt('alphabetical')}</option>
                  </select>
                </div>
              </div>
              {!visible.length ? (
                <div className="im-empty">
                  <MonkMark />
                  <h2>{projects.length ? mt('noMatches') : mt('noProjects')}</h2>
                  {!projects.length && (
                    <>
                      <p>{mt('noProjectsBody')}</p>
                      <button onClick={() => void run(newProject)}>{mt('newProject')}</button>
                    </>
                  )}
                </div>
              ) : (
                <div className="im-project-list">
                  {visible.map((item) => (
                    <article className="im-project-row" key={item.id}>
                      <span className="im-project-icon" aria-hidden="true">
                        ▦
                      </span>
                      <button
                        className="im-project-open"
                        aria-label={`Open last working workbook: ${item.name}`}
                        onClick={() => void run(() => openProject(item))}
                      >
                        <strong>{item.name}</strong>
                        <span>{item.workspace?.description || mt('localWorkspace')}</span>
                        <small>
                          Open last working workbook ·{' '}
                          {(item.workspace?.workingWorkbook ?? item.workspace?.primaryWorkbook)
                            ?.split(/[\\/]/)
                            .pop()}
                        </small>
                      </button>
                      <time dateTime={item.updatedAt}>
                        {new Date(item.updatedAt).toLocaleDateString()}
                      </time>
                      {item.research && (
                        <div className="im-project-status">
                          <small>
                            {item.research.acceptedRows
                              ? `${item.research.acceptedRows} accepted rows across ${item.research.acceptedTables} tables`
                              : item.research.workflowCount
                                ? 'No accepted table yet'
                                : 'Local workbook'}
                            {item.research.activeRuns > 0
                              ? ` · ${item.research.activeRuns} running`
                              : ''}
                          </small>
                          {item.research.pendingReviews > 0 && (
                            <small>
                              {item.research.pendingReviews} candidate
                              {item.research.pendingReviews === 1 ? '' : 's'} awaiting review
                            </small>
                          )}
                          {item.research.unresolvedCells > 0 && (
                            <small>{item.research.unresolvedCells} missing or flagged facts</small>
                          )}
                          {item.research.inputsChanged && (
                            <small>Inputs changed · reviewed refresh needed</small>
                          )}
                          {item.research.reviewWorkflowId && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  setProjectId(item.id)
                                  await navigate('workflows', {
                                    workflowId: item.research!.reviewWorkflowId!,
                                    runId: item.research!.reviewRunId,
                                    needsReview:
                                      !item.research!.reviewRunId &&
                                      item.research!.unresolvedCells > 0,
                                  })
                                })
                              }
                            >
                              Review table: {item.name}
                            </button>
                          )}
                        </div>
                      )}
                      <button
                        aria-label={`${mt('starred')}: ${item.name}`}
                        aria-pressed={item.workspace?.starred}
                        onClick={() =>
                          void run(async () =>
                            changed(
                              await window.infomonk.update(item.id, {
                                starred: !item.workspace?.starred,
                              }),
                            ),
                          )
                        }
                      >
                        {item.workspace?.starred ? '★' : '☆'}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
          {section === 'connections' && (
            <>
              <h1>{mt('connections')}</h1>
              <p>{mt('connectionsInfo')}</p>
              <p className="im-muted">{mt('localAccount')}</p>
              <button onClick={() => void run(showSettings)}>{mt('settings')}</button>
            </>
          )}
          {section === 'localFiles' && (
            <div className="im-local-files">
              <Home />
            </div>
          )}
          {project && isProjectSection && (
            <>
              {section !== 'cleanup' && (
                <header className="im-heading">
                  <div>
                    <p className="im-eyebrow">{project.name}</p>
                    <h1>{mt(section as MonkString)}</h1>
                    <p className="im-muted">{metadata?.description}</p>
                  </div>
                  <button
                    aria-label={mt('editDescription')}
                    onClick={() => {
                      setEditing('description')
                      setEditValue(metadata?.description ?? '')
                    }}
                  >
                    {mt('editDescription')}
                  </button>
                </header>
              )}
              {section === 'sheets' && (
                <div className="im-empty">
                  <h2>{project.name}</h2>
                  <button
                    className="im-primary"
                    onClick={() => void run(() => window.infomonk.open(project.id))}
                  >
                    {mt('sheets')}
                  </button>
                </div>
              )}
              {section === 'sources' && (
                <>
                  <button
                    className="im-primary"
                    onClick={() => void run(() => navigate('workflows'))}
                  >
                    Build a table from sources
                  </button>
                  <p className="im-muted">{mt('sourceInfo')}</p>
                  <div className="im-controls">
                    <button onClick={() => void run(addFile)}>{mt('addFile')}</button>
                    <input
                      type="url"
                      aria-label={mt('url')}
                      placeholder="https://"
                      value={link}
                      onChange={(event) => setLink(event.target.value)}
                    />
                    <button
                      disabled={!link.trim() || busy}
                      onClick={() =>
                        void run(async () => {
                          changed(await window.infomonk.addSource(project.id, { url: link.trim() }))
                          setLink('')
                        })
                      }
                    >
                      {mt('addLink')}
                    </button>
                  </div>
                  {!metadata?.sources.length ? (
                    <div className="im-empty">
                      <h2>{mt('sourceEmpty')}</h2>
                    </div>
                  ) : (
                    <div className="im-project-list">
                      {metadata.sources.map((source) => (
                        <article className="im-source-row" key={source.id}>
                          <div>
                            <strong>{source.name}</strong>
                            <p>{source.snapshotPath ? mt('snapshot') : mt('linkOnly')}</p>
                            <small>{source.sha256?.slice(0, 16) ?? source.uri}</small>
                            <small>Added {new Date(source.addedAt).toLocaleString()}</small>
                            {!!source.previousVersions?.length && (
                              <details>
                                <summary>
                                  {source.previousVersions.length} previous saved versions
                                </summary>
                                {source.previousVersions.map((version, index) => (
                                  <div
                                    className="im-source-version"
                                    key={`${version.sha256}:${index}`}
                                  >
                                    <small>
                                      {version.name} · {new Date(version.addedAt).toLocaleString()}{' '}
                                      · {version.sha256?.slice(0, 16)}
                                    </small>
                                    <button
                                      disabled={busy}
                                      onClick={() =>
                                        void run(() =>
                                          window.infomonk.openSource(
                                            project.id,
                                            source.id,
                                            version.sha256,
                                          ),
                                        )
                                      }
                                    >
                                      Open previous version {index + 1}
                                    </button>
                                  </div>
                                ))}
                              </details>
                            )}
                          </div>
                          {source.snapshotPath && (
                            <button
                              disabled={busy}
                              aria-label={`Update snapshot: ${source.name}`}
                              onClick={() => void run(() => updateSource(source.id))}
                            >
                              Update snapshot
                            </button>
                          )}
                          <button
                            onClick={() =>
                              void run(() => window.infomonk.openSource(project.id, source.id))
                            }
                          >
                            {mt('openSource')}
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              )}
              {section === 'workflows' && (
                <ResearchPanel
                  key={`${project.id}:${selection?.workflowId ?? ''}:${selection?.runId ?? ''}`}
                  project={project}
                  initialSelection={selection}
                  onCreateFrom={(workflowId) => {
                    setTemplate({ projectId: project.id, workflowId })
                    setCreator(true)
                  }}
                />
              )}
              {section === 'outputs' && (
                <>
                  <h2>
                    Accepted revisions
                    {currentOverview?.status === 'ready' ? ` · ${overview.outputCount}` : ''}
                  </h2>
                  <p className="im-muted">
                    Export accepted data includes every table in the selected ledger revision, with
                    tracking, notes and evidence; filters do not narrow the export, and source
                    snapshots remain in this workspace. Native workbook edits require Save and the
                    separate Export workbook action in the spreadsheet editor.
                  </p>
                  {(!currentOverview || currentOverview.status === 'loading') && (
                    <p role="status">Loading accepted revisions…</p>
                  )}
                  {currentOverview?.status === 'failed' && (
                    <p className="im-muted">
                      Accepted revisions could not load. Reopen Outputs to retry.
                    </p>
                  )}
                  {currentOverview?.status === 'ready' && overview.outputCount === 0 && (
                    <p className="im-muted">
                      No accepted revisions yet. Run and review a workflow, then publish its table.
                    </p>
                  )}
                  {exportNotice?.projectId === project.id && (
                    <p className="im-notice" role="status">
                      {exportNotice.text}
                    </p>
                  )}
                  {overview.outputCount > 100 && (
                    <p className="im-muted">
                      Showing the latest 100 accepted revisions. Older files remain in the project
                      folder.
                    </p>
                  )}
                  {overview.outputs.map((output) => (
                    <article
                      className="im-source-row"
                      key={`${output.workflowId}:${output.revision}`}
                    >
                      <div>
                        <strong>
                          {output.name} · revision {output.revision}
                        </strong>
                        <p>
                          {output.current ? 'Current accepted table' : 'Earlier accepted revision'}{' '}
                          · {new Date(output.at).toLocaleString()}
                        </p>
                        <small>Editable workbook · {output.path.split(/[\\/]/).pop()}</small>
                      </div>
                      {output.current && (
                        <button
                          disabled={busy}
                          aria-label={`Inspect accepted table: ${output.name}`}
                          onClick={() =>
                            void run(() =>
                              navigate('workflows', {
                                workflowId: output.workflowId,
                                runId: null,
                              }),
                            )
                          }
                        >
                          Inspect accepted table
                        </button>
                      )}
                      <button
                        disabled={busy}
                        aria-label={`Open ${output.name} revision ${output.revision}`}
                        title="Opens the editable workbook file. Saved native spreadsheet changes may differ from the accepted ledger."
                        onClick={() =>
                          void run(() =>
                            output.current
                              ? window.infomonkResearch.open(project.id, output.workflowId)
                              : window.aiOffice.openPath(output.path),
                          )
                        }
                      >
                        Open editable workbook
                      </button>
                      <button
                        disabled={busy || exporting !== null}
                        aria-label={`Export accepted data: ${output.name} revision ${output.revision}`}
                        onClick={() => void exportAccepted(output)}
                      >
                        Export accepted data
                      </button>
                    </article>
                  ))}
                  <h2>Supporting outputs</h2>
                  <p className="im-muted">{mt('outputInfo')}</p>
                  <div className="im-controls">
                    {(
                      [
                        ['doc', 'createDocument'],
                        ['slide', 'createSlides'],
                        ['markdown', 'createMarkdown'],
                        ['html', 'createHtml'],
                        ['pdf', 'createPdf'],
                      ] as const
                    ).map(([kind, key]) => (
                      <button key={kind} onClick={() => void newOutput(kind)}>
                        {mt(key)}
                      </button>
                    ))}
                  </div>
                  {project.files
                    .filter(
                      (path) =>
                        /\.(docx|pptx|md|html|pdf|xlsx)$/i.test(path) &&
                        path !== metadata?.primaryWorkbook &&
                        !/[\\/](previews|sources)[\\/]/.test(path) &&
                        !/[\\/]research[\\/]Research-/.test(path),
                    )
                    .map((path) => (
                      <article className="im-source-row" key={path}>
                        <strong>{path.split(/[\\/]/).pop()}</strong>
                        <button onClick={() => void run(() => window.aiOffice.openPath(path))}>
                          {mt('openSource')}
                        </button>
                      </article>
                    ))}
                </>
              )}
              {section === 'activity' && (
                <div className="im-timeline">
                  {(!currentOverview || currentOverview.status === 'loading') && (
                    <p role="status">Loading research activity…</p>
                  )}
                  {currentOverview?.status === 'failed' && (
                    <p className="im-muted">
                      Research activity could not load. Local workspace activity remains below.
                    </p>
                  )}
                  {[
                    ...(metadata?.activity ?? []).map((entry, index) => ({
                      ...entry,
                      id: `workspace:${index}`,
                      workflowId: undefined,
                      runId: undefined,
                    })),
                    ...overview.activity,
                  ]
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .slice(0, 100)
                    .map((entry) => (
                      <article key={entry.id}>
                        <span className="im-timeline-dot" />
                        <div>
                          <strong>{entry.text}</strong>
                          <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                          {entry.workflowId && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void run(() =>
                                  navigate('workflows', {
                                    workflowId: entry.workflowId!,
                                    runId: entry.runId ?? null,
                                  }),
                                )
                              }
                            >
                              Open workflow
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                </div>
              )}
              {section === 'cleanup' && (
                <>
                  <CleanupFlow
                    project={project}
                    onChanged={changed}
                    onClose={() => void run(() => navigate('sheets'))}
                  />
                  {metadata?.previousWorkbook && (
                    <button
                      onClick={() =>
                        void run(async () => {
                          changed(await window.infomonk.undoCleanup(project.id))
                          await window.infomonk.open(project.id)
                        })
                      }
                    >
                      {mt('undoCleanup')}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </main>
      )}
      {homeActive && creator && (
        <ProjectCreator
          template={template}
          startKind={startKind}
          onClose={() => setCreator(false)}
          onCreated={(item) => {
            changed(item)
            setCreator(false)
            setProjectId(item.id)
            const documents = item.workspace?.sources.some((source) =>
              /\.(pdf|docx|md|txt)$/i.test(source.name),
            )
            void run(() =>
              template
                ? (async () => {
                    const copied = await window.infomonkResearch.state(item.id)
                    await navigate('workflows', {
                      workflowId: copied.workflows[0].id,
                      runId: null,
                    })
                  })()
                : item.workspace?.startKind === 'researchWeb'
                  ? navigate('workflows')
                  : documents
                    ? navigate('sources')
                    : openProject(item),
            )
          }}
        />
      )}
      {homeActive && editing && project && (
        <div className="im-modal-shade">
          <form
            className="im-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={mt(editing === 'name' ? 'rename' : 'editDescription')}
            onSubmit={(event) => {
              event.preventDefault()
              void run(async () => {
                changed(
                  await window.infomonk.update(
                    project.id,
                    editing === 'name' ? { name: editValue } : { description: editValue },
                  ),
                )
                setEditing(null)
              })
            }}
          >
            <h2>{mt(editing === 'name' ? 'rename' : 'editDescription')}</h2>
            <input
              autoFocus
              aria-label={mt(editing === 'name' ? 'projectName' : 'goal')}
              required={editing === 'name'}
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              maxLength={editing === 'name' ? 120 : 4000}
            />
            <div className="im-actions">
              <button type="button" onClick={() => setEditing(null)}>
                {mt('cancel')}
              </button>
              <button className="im-primary" disabled={busy}>
                {mt('save')}
              </button>
            </div>
          </form>
        </div>
      )}
      {homeActive && settings && (
        <SettingsModal
          status={status}
          loggingOut={false}
          loginWaiting={false}
          loginUrl={null}
          urlCopied={false}
          onOpenLoginUrl={() => void window.aiOffice.openLoginUrl()}
          onCopyLoginUrl={() => {}}
          onClose={() => setSettings(false)}
          onLogin={() =>
            void run(async () => {
              await window.aiOffice.accountLogin()
              setStatus(await window.aiOffice.accountStatus())
            })
          }
          onLogout={() =>
            void run(async () => {
              await window.aiOffice.accountLogout()
              setStatus(await window.aiOffice.accountStatus())
            })
          }
          target={{ section: 'general' }}
        />
      )}
    </div>
  )
}
