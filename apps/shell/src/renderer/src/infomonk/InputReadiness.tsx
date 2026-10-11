import type { ResearchReadiness } from '../../../shared/research-api'

export function InputReadiness({
  report,
  current,
  busy,
  editing,
  checking,
  onCheck,
  onEdit,
  onOpen,
}: {
  report: ResearchReadiness | null
  current: boolean
  busy: boolean
  editing: boolean
  checking: boolean
  onCheck: () => void
  onEdit: () => void
  onOpen: (sourceId: string, version: string) => void
}) {
  return (
    <section className="im-input-readiness" aria-label="Input readiness">
      <h3>Input readiness</h3>
      <p className="im-muted">
        Checks all confirmed local snapshots against the saved quote schema. No run or accepted
        revision is created. Full quote runs check readiness automatically; samples remain available
        for inspection. This check does not perform OCR.
      </p>
      {editing && <p>Save configuration changes before checking or running these inputs.</p>}
      <div className="im-controls">
        <button disabled={busy || editing} onClick={onCheck}>
          {checking ? 'Checking saved inputs…' : 'Check input readiness'}
        </button>
        <button disabled={busy} onClick={onEdit}>
          Edit confirmed inputs
        </button>
      </div>
      {checking && <p role="status">Checking the saved snapshots and their evidence…</p>}
      {report && (
        <>
          {!current && (
            <p role="status" className="im-notice">
              This check is outdated because inputs or configuration changed. Check the current
              saved inputs again.
            </p>
          )}
          <p>
            Configuration {report.configVersion} · checked{' '}
            {new Date(report.checkedAt).toLocaleString()}
          </p>
          <p>
            {report.counts.selected} selected snapshots · {report.counts.unique} unique inputs ·{' '}
            {report.counts.ready} ready · {report.counts.review} need review ·{' '}
            {report.counts.blocked} blocked · {report.counts.duplicates} identical copies
          </p>
          {current && (
            <p
              role={report.readyToRun ? 'status' : 'alert'}
              className={report.readyToRun ? 'im-muted' : 'im-error'}
            >
              {!report.counts.selected
                ? 'Choose input snapshots and save the configuration first.'
                : report.readyToRun
                  ? 'Inputs can run. Missing facts and conflicts still require candidate review before publication.'
                  : 'Full run blocked. Fix the source snapshots or exclude blocked inputs, save the configuration, then check again.'}
            </p>
          )}
          {report.inputs.map((input) => (
            <article key={input.sourceId}>
              <h4>
                {input.sourceName} ·{' '}
                {input.status === 'blocked'
                  ? 'Blocked'
                  : input.duplicateOf
                    ? 'Duplicate content'
                    : input.status === 'review'
                      ? 'Needs review'
                      : 'Ready'}
              </h4>
              <p>
                Quote ID: {input.quoteId ?? 'Missing or unreadable'} · snapshot{' '}
                {input.sourceVersion?.slice(0, 12) ?? 'Unavailable'}
              </p>
              {input.findings.map((value, index) => (
                <div key={index}>
                  <p className={value.severity === 'blocked' ? 'im-error' : 'im-muted'}>
                    {value.message}
                  </p>
                  {value.excerpts.map((excerpt, i) => (
                    <details key={i}>
                      <summary>
                        {excerpt.sourceName} · {excerpt.locator}
                      </summary>
                      <pre>
                        {excerpt.text}
                        {excerpt.truncated ? '\n[Excerpt preview truncated]' : ''}
                      </pre>
                    </details>
                  ))}
                </div>
              ))}
              {input.findingCount > input.findings.length && (
                <p>
                  Showing {input.findings.length} of {input.findingCount} findings. Inspect the
                  source and full candidate for all details.
                </p>
              )}
              {input.sourceVersion && (
                <button
                  disabled={busy || !current}
                  onClick={() => onOpen(input.sourceId, input.sourceVersion!)}
                >
                  Open checked snapshot
                </button>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  )
}
