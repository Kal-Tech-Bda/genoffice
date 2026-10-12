import { useEffect, useState } from 'react'
import type {
  CellDetails,
  EvidenceSelection,
  SheetEvidenceApi,
} from '../../../../shell/src/shared/research-api'

declare global {
  interface Window {
    infomonkEvidence?: SheetEvidenceApi
  }
}
export function EvidenceDetails({
  range,
  read,
}: {
  range: string | null
  read?: (() => EvidenceSelection | null) | undefined
}) {
  const [details, setDetails] = useState<CellDetails | null>(null)
  const [error, setError] = useState('')
  const [inspection, setInspection] = useState<{
    text: string
    locator: string
    sourceName: string
  } | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let live = true
    setInspection(null)
    setError('')
    setDetails(null)
    let selection: EvidenceSelection | null | undefined
    try {
      selection = read?.()
    } catch (err) {
      setError(String(err))
      return () => {
        live = false
      }
    }
    if (selection && window.infomonkEvidence)
      void window.infomonkEvidence
        .cell(selection)
        .then((value) => {
          if (live) setDetails(value)
        })
        .catch((err) => {
          if (live) setError(String(err))
        })
    return () => {
      live = false
    }
  }, [range, reload, read])
  async function inspect(index: number, open: boolean) {
    if (!details || !window.infomonkEvidence) return
    setError('')
    try {
      if (open) await window.infomonkEvidence.open(details, index)
      else setInspection(await window.infomonkEvidence.inspect(details, index))
    } catch (err) {
      setError(String(err))
    }
  }
  return (
    <div className="im-cell-evidence">
      <button onClick={() => setReload((r) => r + 1)}>Reload cell evidence</button>
      {error && <p role="alert">{error}</p>}
      {!details ? (
        <p>
          No accepted research evidence for this selection. Publish a research workflow to attach
          evidence.
        </p>
      ) : (
        <>
          <h3>
            {details.columnName ?? details.columnId} · accepted revision {details.revision}
          </h3>
          <p>
            Accepted value: {String(details.cell.value ?? 'Missing')} · {details.cell.origin}
          </p>
          {details.cell.origin === 'manual' && (
            <p>
              This value is a reviewer override. Source excerpts retain incoming facts; correction
              reasons below explain the accepted change.
            </p>
          )}
          {details.editedInSheet && (
            <p role="alert">
              This workbook or cell differs from the accepted revision. Evidence below supports the
              accepted value. Record persistent corrections in Workflows.
            </p>
          )}
          {details.cell.missingReason && <p role="alert">{details.cell.missingReason}</p>}
          {!details.cell.evidence.length && <p>Missing source evidence.</p>}
          {details.cell.evidence.map((e, i) => (
            <article key={i}>
              <strong>{e.sourceName}</strong>
              <p>{e.uri}</p>
              <p>{e.locator}</p>
              <p>{e.excerpt}</p>
              <small>
                {e.method} · {e.retrievedAt} · SHA256 {e.sourceVersion.slice(0, 16)}
              </small>
              <div>
                <button onClick={() => void inspect(i, false)}>Inspect snapshot</button>
                {!e.locator.startsWith('JSON ') && !e.locator.startsWith('HTML ') && (
                  <button onClick={() => void inspect(i, true)}>Open source snapshot</button>
                )}
              </div>
            </article>
          ))}
          {details.corrections.map((c, i) => (
            <p key={i}>
              Correction: {String(c.value ?? 'Missing')} · {c.reason} · {c.at}
            </p>
          ))}
          {inspection && (
            <div role="status">
              <strong>
                {inspection.sourceName} · {inspection.locator}
              </strong>
              <pre>{inspection.text}</pre>
            </div>
          )}
        </>
      )}
    </div>
  )
}
