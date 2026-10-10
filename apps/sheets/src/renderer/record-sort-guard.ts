import type { UniverRuntime } from './univer-state'

export function recordSortProposalError(
  operations: readonly { op: string; sheetId?: string }[],
  isManaged: (sheetId: string) => boolean,
): string | null {
  return operations.some(
    (operation) =>
      operation.op === 'sort_range' && operation.sheetId && isManaged(operation.sheetId),
  )
    ? 'Use Clean table to sort managed records. Assistant sorting is unavailable for tables with source record IDs.'
    : null
}

export function recordSortAllowed(identityColumn: number, range: unknown): boolean {
  if (!range || typeof range !== 'object') return false
  const area = range as Record<string, unknown>
  return (
    area.startColumn === 0 &&
    typeof area.endColumn === 'number' &&
    area.endColumn >= identityColumn &&
    typeof area.startRow === 'number' &&
    area.startRow >= 1
  )
}

/** A managed record ID must move with every value, never with only some columns. */
export function installRecordSortGuard(
  runtime: UniverRuntime,
  notify: (message: string) => void,
): { dispose(): void } {
  return runtime.univerAPI.addEvent(runtime.univerAPI.Event.BeforeCommandExecute, (event) => {
    if (event.id !== 'sheet.command.sort-range') return
    const params = (event.params ?? {}) as Record<string, unknown>
    const workbook = runtime.univerAPI.getActiveWorkbook()
    const sheet =
      typeof params.subUnitId === 'string'
        ? workbook?.getSheetBySheetId(params.subUnitId)
        : workbook?.getActiveSheet()
    if (!sheet) return
    const row = sheet.getSheet().getSnapshot().cellData?.[0]
    const marker = Object.entries(row ?? {}).find(([, cell]) => cell?.v === '_infomonk_record_id')
    if (marker && !recordSortAllowed(Number(marker[0]), params.range)) {
      event.cancel = true
      notify(
        'To keep source references, sort all data columns including the source record ID, without the header. Or use Clean table.',
      )
    }
  })
}
