import { useId, useState } from 'react'
import type { ResearchRow, ResearchTable } from '../../../shared/research-api'
import './source-checks.css'

type Scope = 'Not checked' | 'Partial check' | 'Bounded check' | 'Retained check'

function text(row: ResearchRow, column: string): string {
  return String(row.cells[column]?.value ?? '')
}

function scope(row: ResearchRow): Scope {
  const status = text(row, 'status')
  if (status === 'Outside selected sources — retained') return 'Retained check'
  if (!text(row, 'last_checked')) return 'Not checked'
  return /\bpartial\b/i.test(status) ? 'Partial check' : 'Bounded check'
}

function host(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return 'Source address unavailable'
  }
}

function readableDate(timestamp: string): string {
  if (!timestamp) return 'Not checked'
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return 'See recorded timestamp'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function SourceChecks({
  table,
  busy,
  onInspect,
}: {
  table: ResearchTable
  busy: boolean
  onInspect: (row: ResearchRow, column: string) => void
}) {
  const [query, setQuery] = useState('')
  const id = useId()
  const needle = query.trim().toLocaleLowerCase()
  const visible = table.rows.filter((row) =>
    [text(row, 'source'), text(row, 'source_url'), text(row, 'status'), scope(row)].some((value) =>
      value.toLocaleLowerCase().includes(needle),
    ),
  )
  const partial = table.rows.filter((row) => scope(row) === 'Partial check').length
  const checked = table.rows.filter((row) =>
    ['Bounded check', 'Partial check'].includes(scope(row)),
  ).length
  const notChecked = table.rows.filter((row) => scope(row) === 'Not checked').length
  const retained = table.rows.filter((row) => scope(row) === 'Retained check').length
  const offset = table.offset ?? 0
  const total = table.totalRows ?? table.rows.length

  return (
    <section className="im-source-checks" aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>Source checks · {total} targets</h3>
      <p className="im-muted">
        A checked source covers its recorded query. Partial checks and unsearched targets remain
        visible; targets can overlap and do not count distinct employers or vacancies.
      </p>
      <div className="im-source-checks-toolbar">
        <label>
          Find a source
          <input
            type="search"
            value={query}
            maxLength={200}
            disabled={busy}
            placeholder="Source name, address or check result"
            aria-describedby={`${id}-page`}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {query && (
          <button type="button" disabled={busy} onClick={() => setQuery('')}>
            Clear source search
          </button>
        )}
      </div>
      <p id={`${id}-page`} className="im-source-checks-page" role="status">
        Showing {visible.length} of {table.rows.length} loaded sources. Search covers only this
        loaded page ({table.rows.length ? offset + 1 : 0}–{offset + table.rows.length} of {total}).
      </p>
      <p className="im-source-checks-counts">
        Loaded page: {checked} checked ({partial} explicitly partial) · {notChecked} not checked
        {retained > 0 && ` · ${retained} retained from earlier scope`}
      </p>
      <div className="im-source-checks-scroll" tabIndex={0} aria-label="Source checks table">
        <table>
          <caption>
            Recorded public-source checks and uncollected targets on this loaded page
          </caption>
          <thead>
            <tr>
              <th scope="col">Source</th>
              <th scope="col">Last checked</th>
              <th scope="col">Matching listings</th>
              <th scope="col">Recorded scope</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="im-source-checks-empty">
                  No loaded sources match. Clear the search or check another source page.
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const name = text(row, 'source') || 'Unnamed source'
              const url = text(row, 'source_url')
              const timestamp = text(row, 'last_checked')
              const matching = row.cells.matched_rows?.value
              const state = scope(row)
              return (
                <tr key={row.id}>
                  <th scope="row">
                    <span className="im-source-checks-name">{name}</span>
                    <small>{host(url)}</small>
                  </th>
                  <td title={timestamp || 'No check recorded'}>{readableDate(timestamp)}</td>
                  <td>
                    {matching == null
                      ? 'Not checked'
                      : typeof matching === 'number'
                        ? matching.toLocaleString()
                        : matching}
                  </td>
                  <td>
                    <span
                      className={`im-source-checks-state ${state === 'Partial check' ? 'is-partial' : ''}`}
                    >
                      {state}
                    </span>
                  </td>
                  <td>
                    <details>
                      <summary aria-label={`Scope and evidence for ${name}`}>
                        Scope and evidence
                      </summary>
                      <dl>
                        <dt>Recorded check result</dt>
                        <dd>{text(row, 'status') || 'No check result recorded'}</dd>
                        <dt>Source URL</dt>
                        <dd>{url || 'No source URL recorded'}</dd>
                        <dt>Exact recorded timestamp</dt>
                        <dd>{timestamp || 'No check recorded'}</dd>
                      </dl>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Inspect check evidence for ${name}`}
                        onClick={() => onInspect(row, 'status')}
                      >
                        Inspect check evidence
                      </button>
                    </details>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
