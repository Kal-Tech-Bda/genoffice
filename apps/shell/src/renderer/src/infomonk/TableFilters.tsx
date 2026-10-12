import { useEffect, useState } from 'react'
import type {
  ResearchSavedView,
  ResearchTable,
  ResearchTableView,
} from '../../../shared/research-api'
import { APPLICATION_STATUSES } from '../../../shared/jobs-api'

export function TableFilters({
  projectId,
  workflowId,
  table,
  view,
  busy,
  reviewOnly,
  onApply,
}: {
  projectId: string
  workflowId: string
  table: ResearchTable
  view?: ResearchTableView
  busy: boolean
  reviewOnly: boolean
  onApply: (view: ResearchTableView) => Promise<void>
}) {
  const [draft, setDraft] = useState<ResearchTableView>(view ?? { tableId: table.id })
  const [saved, setSaved] = useState<ResearchSavedView[]>([])
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [moreFilters, setMoreFilters] = useState(false)
  const viewKey = JSON.stringify(view ?? { tableId: table.id })
  useEffect(() => {
    setDraft(JSON.parse(viewKey) as ResearchTableView)
    const current = JSON.parse(viewKey) as ResearchTableView
    if (
      current.applicationStatus ||
      (current.availability && current.availability !== 'all') ||
      current.sort
    )
      setMoreFilters(true)
  }, [viewKey])
  useEffect(() => {
    let live = true
    setSelected('')
    setName('')
    setSaved([])
    setError('')
    void window.infomonkResearch
      .views(projectId, workflowId)
      .then((views) => {
        if (live) setSaved(views.filter((v) => v.view.tableId === table.id))
      })
      .catch((err) => {
        if (live) setError(String(err))
      })
    return () => {
      live = false
    }
  }, [projectId, workflowId, table.id])
  const disabled = busy || saving
  const pendingChanges = JSON.stringify(draft) !== viewKey
  const cleanQuickView =
    !reviewOnly && !view?.query && !view?.sort && !view?.sourceSites?.length && !view?.changesOnly
  async function save(id?: string) {
    setSaving(true)
    setError('')
    try {
      // A reusable view describes row selection, not a particular refresh comparison.
      const next = { ...draft, changesOnly: false }
      const savedView = await window.infomonkResearch.saveView(
        projectId,
        workflowId,
        name,
        next,
        id,
      )
      setSaved(await window.infomonkResearch.views(projectId, workflowId))
      setSelected(savedView.id)
      await onApply(next)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }
  async function preset(next: ResearchTableView) {
    setSelected('')
    setName('')
    setDraft(next)
    await onApply(next)
  }
  return (
    <section className="im-table-filters" aria-label="Job tracker views">
      <div className="im-view-presets" aria-label="Quick job views">
        <button
          disabled={disabled}
          aria-pressed={
            cleanQuickView &&
            !view?.roleGroups?.length &&
            !view?.applicationStatus &&
            (!view?.availability || view.availability === 'all')
          }
          onClick={() => void preset({ tableId: table.id })}
        >
          All listings
        </button>
        <button
          disabled={disabled}
          aria-pressed={
            cleanQuickView &&
            view?.roleGroups?.length === 2 &&
            view.roleGroups.includes('Technology') &&
            view.roleGroups.includes('Data / research') &&
            !view.applicationStatus &&
            (!view.availability || view.availability === 'all')
          }
          onClick={() =>
            void preset({ tableId: table.id, roleGroups: ['Technology', 'Data / research'] })
          }
        >
          Technology &amp; data
        </button>
        <button
          disabled={disabled}
          aria-pressed={
            cleanQuickView &&
            view?.applicationStatus === 'Saved' &&
            !view.roleGroups?.length &&
            (!view.availability || view.availability === 'all')
          }
          onClick={() => void preset({ tableId: table.id, applicationStatus: 'Saved' })}
        >
          Saved shortlist
        </button>
        <button
          disabled={disabled}
          aria-pressed={
            cleanQuickView &&
            view?.availability === 'review' &&
            !view.roleGroups?.length &&
            !view.applicationStatus
          }
          onClick={() => void preset({ tableId: table.id, availability: 'review' })}
        >
          Check availability
        </button>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void onApply(draft)
        }}
      >
        <div className="im-filter-grid">
          <label className="im-filter-search">
            Search all listings
            <input
              type="search"
              maxLength={200}
              placeholder="Role, employer, location or note"
              value={draft.query ?? ''}
              disabled={disabled}
              onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            />
          </label>
          <label>
            Role group
            <select
              aria-label="Role group"
              disabled={disabled}
              value={draft.roleGroups?.length === 2 ? 'tech-data' : (draft.roleGroups?.[0] ?? '')}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  roleGroups:
                    e.target.value === 'tech-data'
                      ? ['Technology', 'Data / research']
                      : e.target.value
                        ? [e.target.value]
                        : [],
                })
              }
            >
              <option value="">All role groups</option>
              <option value="tech-data">Technology &amp; data</option>
              {(table.facets?.role_group ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value} ({option.count})
                </option>
              ))}
            </select>
          </label>
          <label>
            Listing source
            <select
              aria-label="Listing source"
              disabled={disabled}
              value={draft.sourceSites?.[0] ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, sourceSites: e.target.value ? [e.target.value] : [] })
              }
            >
              <option value="">All collected sources</option>
              {(table.facets?.source_site ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value} ({option.count})
                </option>
              ))}
            </select>
          </label>
        </div>
        <details
          className="im-more-filters"
          open={moreFilters}
          onToggle={(event) => setMoreFilters(event.currentTarget.open)}
        >
          <summary>More filters and sorting</summary>
          <div className="im-filter-grid">
            <label>
              Tracking status
              <select
                aria-label="Tracking status"
                disabled={disabled}
                value={draft.applicationStatus ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, applicationStatus: e.target.value || undefined })
                }
              >
                <option value="">All tracking statuses</option>
                {APPLICATION_STATUSES.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label>
              Availability observation
              <select
                aria-label="Availability observation"
                disabled={disabled}
                value={draft.availability ?? 'all'}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    availability: e.target.value as ResearchTableView['availability'],
                  })
                }
              >
                <option value="all">All observations</option>
                <option value="listed">Listed at last check</option>
                <option value="review">Needs availability review</option>
                <option value="past-deadline">Past employer deadline</option>
                <option value="not-found">Not found at latest check</option>
                <option value="talent-pool">Talent pool / evergreen</option>
              </select>
            </label>
            <label>
              Sort listings
              <select
                aria-label="Sort listings"
                disabled={disabled}
                value={draft.sort ? `${draft.sort.columnId}:${draft.sort.direction}` : ''}
                onChange={(e) => {
                  const [columnId, direction] = e.target.value.split(':')
                  setDraft({
                    ...draft,
                    sort: columnId
                      ? { columnId, direction: direction as 'asc' | 'desc' }
                      : undefined,
                  })
                }}
              >
                <option value="">Source order</option>
                <option value="title:asc">Role A–Z</option>
                <option value="closing_date:asc">Employer deadline, earliest first</option>
                <option value="posted_date:desc">Posted date, newest first</option>
                <option value="source_site:asc">Listing source A–Z</option>
              </select>
            </label>
          </div>
        </details>
        <div className="im-controls">
          <button type="submit" className="im-primary" disabled={disabled}>
            Apply view
          </button>
          <span className="im-muted" role="status">
            {pendingChanges
              ? 'Filters changed. Apply view to update the results.'
              : 'Search covers the complete table.'}
          </span>
        </div>
      </form>
      <details className="im-saved-views">
        <summary>Saved views{saved.length ? ` · ${saved.length}` : ''}</summary>
        <div className="im-controls">
          <label>
            Saved job view
            <select
              aria-label="Saved job view"
              value={selected}
              disabled={disabled}
              onChange={(e) => {
                const id = e.target.value,
                  chosen = saved.find((v) => v.id === id)
                setSelected(id)
                if (chosen) {
                  setName(chosen.name)
                  setDraft(chosen.view)
                  void onApply(chosen.view)
                }
              }}
            >
              <option value="">Choose a saved view</option>
              {saved.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            View name
            <input
              maxLength={80}
              value={name}
              disabled={disabled}
              placeholder="My technology shortlist"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button disabled={disabled || !name.trim()} onClick={() => void save()}>
            Save as new view
          </button>
          {selected && (
            <>
              <button disabled={disabled || !name.trim()} onClick={() => void save(selected)}>
                Update saved view
              </button>
              <button
                disabled={disabled}
                onClick={async () => {
                  setSaving(true)
                  try {
                    await window.infomonkResearch.deleteView(projectId, workflowId, selected)
                    setSaved(await window.infomonkResearch.views(projectId, workflowId))
                    setSelected('')
                    setName('')
                  } catch (err) {
                    setError(String(err))
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                Delete saved view
              </button>
            </>
          )}
        </div>
        <small>
          Views belong to this workflow and survive restart. They do not make a copy of the data.
        </small>
      </details>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
