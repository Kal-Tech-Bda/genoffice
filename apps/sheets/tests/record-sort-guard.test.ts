import { expect, it } from 'vitest'
import { recordSortAllowed, recordSortProposalError } from '../src/renderer/record-sort-guard'

it('allows only full-row data sorts that include the immutable source record ID', () => {
  expect(recordSortAllowed(4, { startRow: 1, startColumn: 0, endColumn: 4 })).toBe(true)
  expect(recordSortAllowed(4, { startRow: 1, startColumn: 0, endColumn: 3 })).toBe(false)
  expect(recordSortAllowed(4, { startRow: 1, startColumn: 1, endColumn: 4 })).toBe(false)
  expect(recordSortAllowed(4, { startRow: 0, startColumn: 0, endColumn: 4 })).toBe(false)
})

it('rejects assistant sorts before expansion can separate values from managed IDs', () => {
  const managed = (id: string) => id === 'managed'
  expect(recordSortProposalError([{ op: 'sort_range', sheetId: 'managed' }], managed)).toContain(
    'Clean table',
  )
  expect(recordSortProposalError([{ op: 'sort_range', sheetId: 'ordinary' }], managed)).toBeNull()
  expect(recordSortProposalError([{ op: 'set_cell', sheetId: 'managed' }], managed)).toBeNull()
})
