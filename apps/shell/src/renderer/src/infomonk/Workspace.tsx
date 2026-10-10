import { useEffect, useState } from 'react'
import { Home } from '../Home'
import { SettingsModal } from '../SettingsModal'
import type { AccountStatus } from '../../../shared/home-api'
import type { WorkspaceApi, WorkspaceProject } from '../../../shared/workspace-api'
import { CleanupFlow } from './CleanupFlow'
import { ProjectCreator } from './ProjectCreator'
import { mt, type MonkString } from './en'
import { MonkMark } from './Mark'
import { ResearchPanel } from './ResearchPanel'
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
  const [search, setSearch] = useState('')
  const [starred, setStarred] = useState(false)
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
    if (activeFile) {
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
        setSection('sheets')
      } else setProjectId(null)
    }
  }, [activeFile, projects])
  useEffect(() => {
    void window.infomonk
      .layout(editorWorkspaceVisible ? 224 : 0, editorWorkspaceVisible ? 56 : 0)
      .catch((err) => setError(String(err)))
  }, [editorWorkspaceVisible])
  async function navigate(next: Section) {
    setSection(next)
    setError('')
    setEditing(null)
    if (next === 'sheets' && project) await window.infomonk.open(project.id)
    else {
      await window.aiOfficeTabs.activate('home')
      if (next === 'outputs' || next === 'activity') await refresh()
    }
  }
  async function openProject(item: WorkspaceProject) {
    setProjectId(item.id)
    setSection('sheets')
    await window.infomonk.open(item.id)
  }
  async function newProject() {
    await window.aiOfficeTabs.activate('home')
    setCreator(true)
  }
  const visible = projects
    .filter(
      (item) =>
        (!starred || item.workspace?.starred) &&
        `${item.name} ${item.workspace?.description}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt),
    )
  async function addFile() {
    const path = await window.infomonk.pickFile()
    if (path && project) changed(await window.infomonk.addSource(project.id, { path }))
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
          <button title={mt('connections')} onClick={() => void run(() => navigate('connections'))}>
            <span>↗</span>
            <span>{mt('connections')}</span>
          </button>
          <button title={mt('localFiles')} onClick={() => void run(() => navigate('localFiles'))}>
            <span>▱</span>
            <span>{mt('localFiles')}</span>
          </button>
          <div className="im-footer-actions">
            <button onClick={() => void run(showSettings)}>{mt('settings')}</button>
            <button
              onClick={() =>
                void run(async () => {
                  await window.aiOffice.openHelp()
                })
              }
            >
              {mt('help')}
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
                      <button key={key} onClick={() => void run(newProject)}>
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
                        onClick={() => void run(() => openProject(item))}
                      >
                        <strong>{item.name}</strong>
                        <span>{item.workspace?.description || mt('localWorkspace')}</span>
                      </button>
                      <time dateTime={item.updatedAt}>
                        {new Date(item.updatedAt).toLocaleDateString()}
                      </time>
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
                          </div>
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
              {section === 'workflows' && <ResearchPanel key={project.id} project={project} />}
              {section === 'outputs' && (
                <>
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
                        !/[\\/]previews[\\/]/.test(path),
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
                  {metadata?.activity.map((entry, index) => (
                    <article key={`${entry.at}:${index}`}>
                      <span className="im-timeline-dot" />
                      <div>
                        <strong>{entry.text}</strong>
                        <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
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
                    onClose={() => setSection('sheets')}
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
          onClose={() => setCreator(false)}
          onCreated={(item) => {
            changed(item)
            setCreator(false)
            void run(() => openProject(item))
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
