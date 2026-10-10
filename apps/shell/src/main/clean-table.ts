import { createHash, randomUUID } from 'node:crypto'
import JSZip from 'jszip'
import { z } from 'zod'
import { applyStructuralOps } from '@genoffice/xlsx-gateway/gateway/xlsx-structure'
import {
  applyCellEditsToXlsx,
  readBasicWorkbook,
  toA1Address,
  type CellEdit,
} from '@genoffice/xlsx-gateway/gateway/xlsx-gateway'
import type { CellScalar, CellState } from '@genoffice/xlsx-gateway/domain/workbook.types'
import type { CleanupOptions, CleanupPreview, TableProfile } from '../shared/workspace-api'

export const MAX_TABLE_CELLS = 100_000
const LINEAGE_PART = 'infomonk/records.json'
interface RecordSource {
  id: string
  row: number
  version: string
  sheet: string
}
interface Lineage {
  version: 1
  sheets: Record<string, Record<string, RecordSource>>
}
const lineageSchema = z.object({
  version: z.literal(1),
  sheets: z.record(
    z.string().max(31),
    z.record(
      z.string().max(200),
      z.object({
        id: z.string().max(200),
        row: z.number().int().min(1).max(1_048_576),
        version: z.string().regex(/^[a-f0-9]{64}$/),
        sheet: z.string().min(1).max(31),
      }),
    ),
  ),
})
export interface LoadedTable {
  buffer: Buffer
  sha256: string
  profile: TableProfile
  options: Pick<CleanupOptions, 'sheetId' | 'range' | 'hasHeader'>
  sheetName: string
  cells: Map<string, CellState>
  rows: CellScalar[][]
  startRow: number
  startColumn: number
  records: RecordSource[]
  lineage: Lineage
  identityColumn: number | null
  date1904: boolean
  hasAnyFormulas: boolean
}
export interface CleanPlan {
  table: LoadedTable
  options: CleanupOptions
  rows: CellScalar[][]
  sourceIndexes: number[]
  preview: CleanupPreview
}
export function digest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
function coordinates(address: string): [number, number] {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(address.toUpperCase())
  if (!match) throw new Error('Use an A1 range, such as A1:D20.')
  let column = 0
  for (const letter of match[1]!) column = column * 26 + letter.charCodeAt(0) - 64
  return [Number(match[2]) - 1, column - 1]
}
function bounds(range: string): [number, number, number, number] {
  const [first, last = first] = range.split(':')
  const [r1, c1] = coordinates(first!)
  const [r2, c2] = coordinates(last!)
  if (r2 < r1 || c2 < c1 || r2 > 1_048_575 || c2 > 16_382) throw new Error('Invalid table range.')
  if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_TABLE_CELLS)
    throw new Error('Cleanup supports at most 100,000 cells. Choose a smaller range.')
  return [r1, c1, r2, c2]
}
const blank = (value: CellScalar) =>
  value === null || (typeof value === 'string' && value.trim() === '')

export async function loadTable(
  buffer: Buffer,
  sheetId?: string,
  range?: string,
  hasHeader = true,
): Promise<LoadedTable> {
  if (buffer.length > 32 * 1024 * 1024) throw new Error('Cleanup supports files up to 32 MiB.')
  const imported = await readBasicWorkbook(buffer)
  const zip = await JSZip.loadAsync(buffer)
  const storedLineage = await zip.file(LINEAGE_PART)?.async('string')
  const lineage: Lineage = storedLineage
    ? lineageSchema.parse(JSON.parse(storedLineage))
    : { version: 1, sheets: {} }
  const sha256 = digest(buffer)
  const metadata = imported.snapshot.sheets.map((sheet) => {
    let rows = 1,
      columns = 1
    for (const address of Object.keys(sheet.cells)) {
      const [r, c] = coordinates(address)
      rows = Math.max(rows, r + 1)
      columns = Math.max(columns, c + 1)
    }
    return {
      id: sheet.id,
      name: sheet.name,
      rows,
      columns,
      range: `A1:${toA1Address(rows - 1, columns - 1)}`,
    }
  })
  const sheet =
    imported.snapshot.sheets.find((item) => item.id === sheetId) ?? imported.snapshot.sheets[0]!
  if (sheetId && sheet.id !== sheetId) throw new Error('Worksheet not found.')
  const meta = metadata.find((item) => item.id === sheet.id)!
  const [startRow, startColumn, endRow, endColumn] = bounds(range ?? meta.range)
  if (endRow >= meta.rows || endColumn >= meta.columns)
    throw new Error('Choose a range within the used worksheet.')
  const cells = new Map(Object.entries(sheet.cells))
  const rows = Array.from({ length: endRow - startRow + 1 }, (_, r) =>
    Array.from(
      { length: endColumn - startColumn + 1 },
      (_, c) => cells.get(toA1Address(startRow + r, startColumn + c))?.value ?? null,
    ),
  )
  const formulaCount = [...cells.entries()].filter(([address, cell]) => {
    const [row, column] = coordinates(address)
    return (
      cell.formula &&
      row >= startRow &&
      row <= endRow &&
      column >= startColumn &&
      column <= endColumn
    )
  }).length
  const allFormulas = imported.snapshot.sheets.some((item) =>
    Object.values(item.cells).some((cell) => cell.formula),
  )
  const workbookXml = await zip.file('xl/workbook.xml')!.async('string')
  const workbookFeatures = /<(?:\w+:)?(?:definedNames|workbookProtection)\b/.test(workbookXml)
  const features = Object.keys(zip.files).some((name) =>
    /^xl\/(tables|pivotTables|drawings|comments|threadedComments|externalLinks|slicers|embeddings)/.test(
      name,
    ),
  )
  const complexXml = (
    await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^xl\/worksheets\/[^/]+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async('string')),
    )
  ).some((xml) =>
    /<(?:\w+:)?(?:mergeCells|sheetProtection|autoFilter|conditionalFormatting|dataValidations|hyperlinks|extLst|legacyDrawing|rowBreaks|colBreaks)\b/.test(
      xml,
    ),
  )
  let structuralBlocker: string | null = null
  if (allFormulas)
    structuralBlocker =
      'Sorting or removing rows is unavailable when the workbook has formulas. Trimming, renaming and formatting remain available; formulas stay intact.'
  else if (features || complexXml || workbookFeatures)
    structuralBlocker =
      'Row changes are unavailable for workbooks with named ranges, tables, merges, comments, drawings, protection, filters, validation or other advanced structures. Use ordinary editor commands, or a simple table.'
  else if (
    startRow !== 0 ||
    startColumn !== 0 ||
    endRow !== meta.rows - 1 ||
    endColumn !== meta.columns - 1 ||
    !hasHeader
  )
    structuralBlocker = 'Row changes require the whole used worksheet starting at A1, with headers.'
  const headers = rows[0]!.map((value, c) =>
    hasHeader ? String(value ?? `Column ${c + 1}`) : `Column ${c + 1}`,
  )
  const data = rows.slice(hasHeader ? 1 : 0)
  const columns = headers.map((name, c) => {
    const values = data.map((row) => row[c] ?? null)
    const numbers = values.filter((value): value is number => typeof value === 'number')
    return {
      name,
      blanks: values.filter(blank).length,
      numbers: numbers.length,
      total: numbers.reduce((sum, value) => sum + value, 0),
    }
  })
  const markerAddress = [...cells.entries()].find(
    ([address, cell]) => coordinates(address)[0] === 0 && cell.value === '_infomonk_record_id',
  )?.[0]
  const identityColumn = storedLineage && markerAddress ? coordinates(markerAddress)[1] : null
  const records = rows.map((_, index) => {
    const originalRow = startRow + index
    const id =
      identityColumn === null ? null : cells.get(toA1Address(originalRow, identityColumn))?.value
    return (
      (typeof id === 'string' && lineage.sheets[sheet.name]?.[id]) || {
        id: `${sha256.slice(0, 16)}:${sheet.id}:${originalRow + 1}`,
        row: originalRow + 1,
        version: sha256,
        sheet: sheet.name,
      }
    )
  })
  const date1904 = /date1904=["'](?:1|true)["']/.test(workbookXml)
  return {
    buffer,
    sha256,
    cells,
    rows,
    records,
    lineage,
    identityColumn,
    date1904,
    hasAnyFormulas: allFormulas,
    startRow,
    startColumn,
    sheetName: sheet.name,
    options: { sheetId: sheet.id, range: range ?? meta.range, hasHeader },
    profile: {
      sha256,
      sheets: metadata,
      sheetId: sheet.id,
      range: range ?? meta.range,
      headers,
      sample: rows.slice(0, 8),
      rowCount: data.length,
      formulaCount,
      columns,
      structuralBlocker,
      recordReferences: records.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + 8),
    },
  }
}

function dateSerial(value: string, policy: 'date-iso' | 'date-us' | 'date-uk'): number | null {
  const match =
    policy === 'date-iso'
      ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
      : /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  if (!match) return null
  const year = Number(match[policy === 'date-iso' ? 1 : 3])
  const month = Number(match[policy === 'date-iso' ? 2 : policy === 'date-us' ? 1 : 2])
  const day = Number(match[policy === 'date-iso' ? 3 : policy === 'date-us' ? 2 : 1])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    year < 1900 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null
  const serial = (date.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000
  return year === 1900 && month < 3 ? serial - 1 : serial
}
export function planCleanup(table: LoadedTable, options: CleanupOptions): CleanPlan {
  const width = table.rows[0]!.length
  if (
    [
      ...options.keys,
      ...Object.keys(options.renames).map(Number),
      ...Object.keys(options.formats).map(Number),
      ...(options.sortColumn === null ? [] : [options.sortColumn]),
    ].some((c) => !Number.isInteger(c) || c < 0 || c >= width)
  )
    throw new Error('Choose valid columns.')
  if (
    table.identityColumn !== null &&
    (options.renames[String(table.identityColumn - table.startColumn)] !== undefined ||
      options.formats[String(table.identityColumn - table.startColumn)] !== undefined)
  )
    throw new Error('The source record ID column cannot be renamed or normalized.')
  if (options.deduplicate && options.keys.length === 0)
    throw new Error('Choose at least one duplicate key.')
  if (
    (options.deduplicate || options.removeBlankRows || options.sortColumn !== null) &&
    table.profile.structuralBlocker
  )
    throw new Error(table.profile.structuralBlocker)
  if (!options.hasHeader && Object.keys(options.renames).length)
    throw new Error('Column renaming requires a header row.')
  if (Object.values(options.formats).some((format) => format !== 'number') && table.date1904)
    throw new Error('Date normalization is unavailable for 1904-date workbooks.')
  const warnings = new Set<string>()
  let changedCells = 0,
    duplicates = 0,
    blankRows = 0
  const transformed = table.rows.map((row, index) => ({
    index,
    values: row.map((initial, c) => {
      const cell = table.cells.get(toA1Address(table.startRow + index, table.startColumn + c))
      if (cell?.formula) return initial
      let value = initial
      if (options.trim && typeof value === 'string') value = value.trim()
      if (options.hasHeader && index === 0 && options.renames[String(c)] !== undefined)
        value = options.renames[String(c)]!
      const policy = index === 0 && options.hasHeader ? undefined : options.formats[String(c)]
      if (
        policy &&
        policy !== 'number' &&
        typeof value === 'number' &&
        (value < 1 || value > 2_958_465)
      )
        throw new Error(
          `Numeric values in ${table.profile.headers[c]} are outside the supported Excel date range. Keep their current format or choose another column.`,
        )
      if (policy && typeof value === 'string' && !blank(value)) {
        const text = value.trim()
        const parsedNumber = Number(text)
        const normalized =
          policy === 'number'
            ? /^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) &&
              (!Number.isInteger(parsedNumber) || Number.isSafeInteger(parsedNumber))
              ? parsedNumber
              : null
            : dateSerial(text, policy)
        if (normalized !== null && Number.isFinite(normalized)) value = normalized
        else
          warnings.add(
            `Some values in ${table.profile.headers[c]} were kept unchanged: they do not match the chosen format. Leading-zero identifiers are preserved.`,
          )
      }
      if (value !== initial) changedCells++
      return value
    }),
  }))
  const header = options.hasHeader ? transformed.shift() : undefined
  const seen = new Set<string>()
  const retained = transformed.filter((row) => {
    if (
      options.removeBlankRows &&
      row.values.every(
        (value, column) => table.startColumn + column === table.identityColumn || blank(value),
      )
    ) {
      blankRows++
      return false
    }
    if (options.deduplicate) {
      const keyValues = options.keys.map((c) => row.values[c])
      if (keyValues.some((value) => blank(value ?? null))) {
        warnings.add('Rows with missing duplicate keys were retained.')
        return true
      }
      const key = JSON.stringify(keyValues)
      if (seen.has(key)) {
        duplicates++
        return false
      }
      seen.add(key)
    }
    return true
  })
  if (options.sortColumn !== null) {
    const column = options.sortColumn
    retained.sort((a, b) => {
      const av = a.values[column] ?? null,
        bv = b.values[column] ?? null
      if (blank(av) !== blank(bv)) return blank(av) ? 1 : -1
      const order =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av ?? '').localeCompare(String(bv ?? ''), 'en', { numeric: true })
      return (options.descending ? -order : order) || a.index - b.index
    })
  }
  const output = header ? [header, ...retained] : retained
  changedCells = output.reduce(
    (count, row) =>
      count +
      row.values.filter((value, column) => value !== table.rows[row.index]?.[column]).length,
    0,
  )
  return {
    table,
    options,
    rows: output.map((row) => row.values),
    sourceIndexes: output.map((row) => row.index),
    preview: {
      token: randomUUID(),
      before: table.rows.slice(0, 8),
      after: output.slice(0, 8).map((row) => row.values),
      inputRows: transformed.length,
      outputRows: retained.length,
      changedCells,
      duplicates,
      blankRows,
      warnings: [...warnings],
    },
  }
}

export async function buildCleanWorkbook(plan: CleanPlan): Promise<Buffer> {
  const { table, options } = plan
  const edits: CellEdit[] = []
  const outputBySource = new Map(
    plan.sourceIndexes.map((source, index) => [source, plan.rows[index]!]),
  )
  for (let r = 0; r < table.rows.length; r++)
    for (let c = 0; c < table.rows[r]!.length; c++) {
      const original = table.cells.get(toA1Address(table.startRow + r, table.startColumn + c)) ?? {
        value: null,
      }
      if (original.formula) continue
      const output = outputBySource.get(r)?.[c] ?? table.rows[r]![c] ?? null
      const format = r === 0 && options.hasHeader ? undefined : options.formats[String(c)]
      if (output !== original.value || format)
        edits.push({
          sheetName: table.sheetName,
          row: table.startRow + r,
          column: table.startColumn + c,
          writeValue: output !== original.value,
          cell: { value: output },
          ...(format
            ? { style: { numberFormat: format === 'number' ? '0.00' : 'yyyy-mm-dd' } }
            : {}),
        })
    }
  const mutation = await applyCellEditsToXlsx(table.buffer, edits)
  const zip = await JSZip.loadAsync(mutation.buffer)
  const workbook = await zip.file('xl/workbook.xml')!.async('string')
  const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
  const sheetTag = [...workbook.matchAll(/<sheet\b[^>]*>/g)].find((match) =>
    match[0].includes(`name="${table.sheetName.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`),
  )?.[0]
  const rid = /r:id="([^"]+)"/.exec(sheetTag ?? '')?.[1]
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].find((match) =>
    match[0].includes(` Id="${rid}"`),
  )?.[0]
  const target = /Target="([^"]+)"/.exec(rel ?? '')?.[1]
  if (!target) throw new Error('Unable to locate the selected worksheet.')
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
  let xml = await zip.file(sheetPath)!.async('string')
  const rows = new Map(
    [...xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)].map((match) => [
      Number(match[1]) - 1,
      match[0],
    ]),
  )
  if (
    table.rows.some(
      (values, index) =>
        values.some((value) => value !== null) && !rows.has(table.startRow + index),
    )
  )
    throw new Error(
      'This worksheet row layout is unsupported for cleanup. The original workbook is unchanged.',
    )
  const reordered =
    plan.sourceIndexes.some((index, position) => index !== position) ||
    plan.rows.length !== table.rows.length
  if (reordered) {
    const replacement = plan.sourceIndexes
      .map((sourceIndex, index) => {
        const row = rows.get(table.startRow + sourceIndex) ?? `<row r="${sourceIndex + 1}"></row>`
        return row
          .replace(/(<row\b[^>]*\br=")\d+("[^>]*>)/, `$1${index + 1}$2`)
          .replace(/(<c\b[^>]*\br="[A-Z]+)\d+("[^>]*>)/g, `$1${index + 1}$2`)
      })
      .join('')
    xml = xml.replace(
      /<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/,
      `<sheetData>${replacement}</sheetData>`,
    )
  }
  zip.file(sheetPath, xml)
  const dateColumns = Object.entries(options.formats)
    .filter(([, format]) => format !== 'number')
    .map(([column]) => table.startColumn + Number(column))
  if (dateColumns.length)
    zip.file(
      sheetPath,
      applyStructuralOps(
        xml,
        dateColumns.map((column) => ({
          kind: 'set-col-size',
          start: column,
          end: column,
          size: 14,
        })),
        table.sheetName,
      ),
    )
  // Identity is part of the row, not its current A1 position. Managed cleanup
  // sorting moves it together with all values; partial editor sorts are outside this contract.
  if (
    options.hasHeader &&
    table.startRow === 0 &&
    table.startColumn === 0 &&
    !table.hasAnyFormulas &&
    (table.identityColumn !== null || table.profile.structuralBlocker === null)
  ) {
    const column =
      table.identityColumn ??
      table.profile.sheets.find((sheet) => sheet.id === table.profile.sheetId)!.columns
    const recordEdits: CellEdit[] = [
      {
        sheetName: table.sheetName,
        row: 0,
        column,
        writeValue: true,
        cell: { value: '_infomonk_record_id' },
      },
    ]
    const mapping = { ...table.lineage.sheets[table.sheetName] }
    for (let r = 1; r < plan.rows.length; r++) {
      const record = table.records[plan.sourceIndexes[r]!]!
      recordEdits.push({
        sheetName: table.sheetName,
        row: r,
        column,
        writeValue: true,
        cell: { value: record.id },
      })
      mapping[record.id] = record
    }
    const withIds = await applyCellEditsToXlsx(
      await zip.generateAsync({ type: 'nodebuffer' }),
      recordEdits,
    )
    const result = await JSZip.loadAsync(withIds.buffer)
    const withIdentity = await result.file(sheetPath)!.async('string')
    result.file(
      sheetPath,
      applyStructuralOps(
        withIdentity,
        [{ kind: 'set-cols-hidden', start: column, end: column, hidden: true }],
        table.sheetName,
      ),
    )
    table.lineage.sheets = { ...table.lineage.sheets, [table.sheetName]: mapping }
    result.file(LINEAGE_PART, JSON.stringify(table.lineage))
    const contentTypes = await result.file('[Content_Types].xml')!.async('string')
    if (!contentTypes.includes('/infomonk/records.json'))
      result.file(
        '[Content_Types].xml',
        contentTypes.replace(
          '</Types>',
          '<Override PartName="/infomonk/records.json" ContentType="application/json"/></Types>',
        ),
      )
    const rootRels = await result.file('_rels/.rels')!.async('string')
    if (!rootRels.includes('urn:infomonk:relationships:records'))
      result.file(
        '_rels/.rels',
        rootRels.replace(
          '</Relationships>',
          '<Relationship Id="InfomonkRecords" Type="urn:infomonk:relationships:records" Target="infomonk/records.json"/></Relationships>',
        ),
      )
    return result.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
