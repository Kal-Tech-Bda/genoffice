import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { sheetCsvToXlsxBuffer } from '@genoffice/xlsx-gateway/gateway/csv-import'
import { buildCleanWorkbook, loadTable, planCleanup } from '../src/main/clean-table'
import type { CleanupOptions } from '../src/shared/workspace-api'

function options(
  table: Awaited<ReturnType<typeof loadTable>>,
  extra: Partial<CleanupOptions> = {},
): CleanupOptions {
  return {
    ...table.options,
    trim: true,
    removeBlankRows: false,
    keys: [],
    deduplicate: false,
    sortColumn: null,
    descending: false,
    renames: {},
    formats: {},
    ...extra,
  }
}
describe('bounded cleanup', () => {
  it('rejects malformed imported record metadata and 1904-date normalization', async () => {
    const zip = await JSZip.loadAsync(await sheetCsvToXlsxBuffer('Name,Date\nAlpha,2026-03-02'))
    const workbook = await zip.file('xl/workbook.xml')!.async('string')
    zip.file('xl/workbook.xml', workbook.replace('<sheets>', '<workbookPr date1904="1"/><sheets>'))
    const table = await loadTable(await zip.generateAsync({ type: 'nodebuffer' }))
    expect(() => planCleanup(table, options(table, { formats: { '1': 'date-iso' } }))).toThrow(
      '1904',
    )
    zip.file(
      'infomonk/records.json',
      JSON.stringify({
        version: 1,
        sheets: { Sheet1: { bad: { id: 'bad', row: -1, version: 42, sheet: 'Sheet1' } } },
      }),
    )
    await expect(loadTable(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow()
  })
  it('profiles the entire range, preserves leading zeros, blanks and numeric totals', async () => {
    const table = await loadTable(
      await sheetCsvToXlsxBuffer('ID,Name,Amount\n001, Alpha ,10\n002,Beta,15\n003,Gamma,'),
    )
    expect(table.profile.rowCount).toBe(3)
    expect(table.profile.columns[2]).toMatchObject({ blanks: 1, total: 25 })
    const plan = planCleanup(
      table,
      options(table, { formats: { '0': 'number' }, renames: { '1': 'Supplier name' } }),
    )
    expect(plan.rows[0]).toEqual(['ID', 'Supplier name', 'Amount'])
    expect(plan.rows[1]).toEqual(['001', 'Alpha', 10])
    expect(plan.preview.warnings.length).toBe(1)
  })
  it('sorts and deduplicates using chosen keys, keeping missing keys and moving source IDs', async () => {
    const table = await loadTable(
      await sheetCsvToXlsxBuffer(
        'ID,Name,Amount\n002,Beta,15\n001,Alpha,10\n001,Other,20\n,Missing,4\n,Other missing,5',
      ),
    )
    const plan = planCleanup(table, options(table, { keys: [0], deduplicate: true, sortColumn: 0 }))
    expect(plan.preview).toMatchObject({ duplicates: 1, inputRows: 5, outputRows: 4 })
    expect(plan.sourceIndexes).toEqual([0, 2, 1, 4, 5])
    const reopened = await loadTable(await buildCleanWorkbook(plan))
    expect(reopened.rows[1]?.[0]).toBe('001')
    expect(reopened.records[1]).toMatchObject({ row: 3, version: table.sha256 })
    const sortedAgain = await loadTable(
      await buildCleanWorkbook(
        planCleanup(reopened, options(reopened, { sortColumn: 0, descending: true })),
      ),
    )
    expect(sortedAgain.records[1]).toMatchObject({ row: 2, version: table.sha256 })
  })
  it('retains formulas and styles and refuses row removal even on another formula sheet', async () => {
    const buffer = await sheetCsvToXlsxBuffer(
      'ID,Name,Amount\n001, Alpha ,10\n002,Beta,15\n,Total,25',
    )
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    zip.file(
      'xl/worksheets/sheet1.xml',
      xml.replace('<c r="C4"><v>25</v></c>', '<c r="C4"><f>SUM(C2:C3)</f><v>25</v></c>'),
    )
    const table = await loadTable(await zip.generateAsync({ type: 'nodebuffer' }))
    expect(table.profile.formulaCount).toBe(1)
    expect(() => planCleanup(table, options(table, { deduplicate: true, keys: [0] }))).toThrow(
      'formulas',
    )
    const output = await JSZip.loadAsync(
      await buildCleanWorkbook(planCleanup(table, options(table))),
    )
    expect(await output.file('xl/worksheets/sheet1.xml')!.async('string')).toContain(
      '<f>SUM(C2:C3)</f>',
    )
    expect(await output.file('xl/styles.xml')!.async('string')).toBe(
      await zip.file('xl/styles.xml')!.async('string'),
    )
  })
  it('requires whole-sheet scope for row changes and validates dates without guessing', async () => {
    const buffer = await sheetCsvToXlsxBuffer(
      'Name,Date\nAlpha,02/03/2026\nBeta,31/02/2026\nGamma,2026-01-01',
    )
    const table = await loadTable(buffer)
    const plan = planCleanup(table, options(table, { formats: { '1': 'date-uk' } }))
    expect(plan.rows[1]?.[1]).toBe(46083)
    expect(plan.rows[2]?.[1]).toBe('31/02/2026')
    expect(plan.rows[3]?.[1]).toBe('2026-01-01')
    const partial = await loadTable(buffer, undefined, 'A1:B2')
    expect(() => planCleanup(partial, options(partial, { sortColumn: 0 }))).toThrow(
      'whole used worksheet',
    )
    const numeric = await loadTable(await sheetCsvToXlsxBuffer('Date\n9999999'))
    expect(() => planCleanup(numeric, options(numeric, { formats: { '0': 'date-iso' } }))).toThrow(
      'Excel date range',
    )
  })
  it('preserves row styles when moving flat rows and keeps unrelated parts', async () => {
    const zip = await JSZip.loadAsync(await sheetCsvToXlsxBuffer('ID,Name\n002,Beta\n001,Alpha'))
    let xml = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    xml = xml.replace('<row r="3">', '<row r="3" ht="31" customHeight="1">')
    zip.file('xl/worksheets/sheet1.xml', xml)
    zip.file('docProps/test.txt', 'untouched')
    const table = await loadTable(await zip.generateAsync({ type: 'nodebuffer' }))
    const result = await JSZip.loadAsync(
      await buildCleanWorkbook(planCleanup(table, options(table, { sortColumn: 0 }))),
    )
    expect(await result.file('xl/worksheets/sheet1.xml')!.async('string')).toContain(
      '<row r="2" ht="31" customHeight="1">',
    )
    expect(await result.file('docProps/test.txt')!.async('string')).toBe('untouched')
    const quoted = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }))
    quoted.file('xl/worksheets/sheet1.xml', xml.replace('<row r="3"', "<row r='3'"))
    const unusual = await loadTable(await quoted.generateAsync({ type: 'nodebuffer' }))
    await expect(
      buildCleanWorkbook(planCleanup(unusual, options(unusual, { sortColumn: 0 }))),
    ).rejects.toThrow('row layout')
    const workbook = await zip.file('xl/workbook.xml')!.async('string')
    zip.file(
      'xl/workbook.xml',
      workbook.replace(
        '</workbook>',
        '<definedNames><definedName name="Suppliers">Sheet1!$A$2:$B$3</definedName></definedNames></workbook>',
      ),
    )
    const named = await loadTable(await zip.generateAsync({ type: 'nodebuffer' }))
    expect(() => planCleanup(named, options(named, { sortColumn: 0 }))).toThrow('named ranges')
    const scalar = await JSZip.loadAsync(
      await buildCleanWorkbook(planCleanup(named, options(named))),
    )
    expect(scalar.file('infomonk/records.json')).toBeNull()
  })
})
