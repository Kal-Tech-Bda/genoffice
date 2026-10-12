import { createHash } from 'node:crypto'
import {
  publicHtml,
  htmlTag,
  htmlAttr,
  htmlPath,
  type HtmlNode,
} from '@genoffice/electron-utils/public-html'
import type { Evidence, ResearchDataset, ResearchTable } from '../../shared/research-api'
import type { ParsedUnit } from './extract'

export const HTML_TABLE_METHOD = 'html-tables-v1'
const MAX_BYTES = 2 * 1024 * 1024
const MAX_CELLS = 100_000
const MAX_TEXT = 2000
const MAX_NOTES = 20
const MAX_NOTE_TEXT = 20_000
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

export interface HtmlTableText {
  text: string
  locator: string
}
export interface HtmlTableColumn extends HtmlTableText {
  id: string
}
export interface HtmlTableNote extends HtmlTableText {
  shared?: true
}
export interface HtmlTableSummary {
  id: string
  name: string
  locator: string
  caption: string | null
  heading: string | null
  columns: HtmlTableColumn[]
  rows: { locator: string; cells: HtmlTableText[] }[]
  rowCount: number
  headerNeedsConfirmation: boolean
  notes: HtmlTableNote[]
  pagination: boolean
  supported: boolean
  blockers: string[]
  warnings: string[]
}
export interface ParsedHtmlTables {
  method: typeof HTML_TABLE_METHOD
  sourceVersion: string
  tables: HtmlTableSummary[]
  units: ParsedUnit[]
  issues: string[]
}
export interface HtmlTableSelection {
  tableId: string
  keyColumns: string[]
  confirmFirstRowAsHeader?: boolean
}

const children = (node: HtmlNode): HtmlNode[] => ('childNodes' in node ? node.childNodes : [])
const parent = (node: HtmlNode): HtmlNode | null => ('parentNode' in node ? node.parentNode : null)
function insideTable(node: HtmlNode): boolean {
  for (let current = parent(node); current; current = parent(current))
    if (htmlTag(current) === 'table') return true
  return false
}
function descendants(node: HtmlNode): HtmlNode[] {
  const result: HtmlNode[] = []
  const pending = [...children(node)].reverse()
  while (pending.length) {
    const next = pending.pop()!
    result.push(next)
    pending.push(...children(next).slice().reverse())
  }
  return result
}
const BLOCK_TAGS = new Set(['br', 'p', 'div', 'li', 'section', 'article', 'h1', 'h2', 'h3'])
/** Inline text stays adjacent: neither ordinals nor numbers gain spaces at tag boundaries. */
function tableText(node: HtmlNode): string {
  function raw(current: HtmlNode): string {
    if ('value' in current) return current.value
    const tag = htmlTag(current)
    if (['script', 'style', 'template'].includes(tag)) return ''
    const text = children(current).map(raw).join('')
    return BLOCK_TAGS.has(tag) ? ` ${text} ` : text
  }
  return raw(node).replace(/\s+/g, ' ').trim()
}
const unit = (node: HtmlNode): HtmlTableText => ({ text: tableText(node), locator: htmlPath(node) })
function hidden(node: HtmlNode): boolean {
  return (
    ('attrs' in node && node.attrs.some((a) => a.name === 'hidden')) ||
    htmlAttr(node, 'aria-hidden') === 'true' ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(htmlAttr(node, 'style'))
  )
}
function activePagination(node: HtmlNode): boolean {
  const tag = htmlTag(node)
  if (!['a', 'button'].includes(tag) || hidden(node)) return false
  if (
    htmlAttr(node, 'aria-disabled') === 'true' ||
    ('attrs' in node && node.attrs.some((a) => a.name === 'disabled'))
  )
    return false
  for (let current = parent(node); current; current = parent(current))
    if (htmlAttr(current, 'role') === 'dialog') return false
  return (
    htmlAttr(node, 'rel').split(/\s+/).includes('next') ||
    /^(?:next(?:\s+(?:page|results?|rows)(?:\s+\d+)?)?|load more|show more|more results)\s*[›»]?$|^[›»]$/i.test(
      htmlAttr(node, 'aria-label') || tableText(node),
    )
  )
}

/** Discover the entire captured static source. No scripts, HTTP requests or source mutation. */
export function parseHtmlTables(bytes: Buffer): ParsedHtmlTables {
  if (bytes.length > MAX_BYTES) throw new Error('HTML exceeds the 2 MiB source limit.')
  new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  const nodes = publicHtml(bytes, { sourceCodeLocationInfo: true })
  const issues: string[] = []
  const pagination = nodes.some(activePagination)
  const units: ParsedUnit[] = []
  const indices = new Map(nodes.map((node, index) => [node, index]))
  const sourceTables = nodes.filter((node) => htmlTag(node) === 'table')
  const tables = nodes
    .filter((node) => htmlTag(node) === 'table')
    .map((table, ordinal): HtmlTableSummary => {
      const blockers: string[] = []
      const warnings: string[] = []
      const sub = descendants(table)
      const offset = indices.get(table)!
      const headingNode = nodes
        .slice(0, offset)
        .reverse()
        .find((node) => /^h[1-6]$/.test(htmlTag(node)) && !insideTable(node) && tableText(node))
      const captionNode = children(table).find((node) => htmlTag(node) === 'caption')
      const heading = headingNode ? tableText(headingNode) : null
      const caption = captionNode ? tableText(captionNode) : null
      const name = caption || heading || `Table ${ordinal + 1}`
      const nextSection = nodes.findIndex(
        (node, index) =>
          index > offset &&
          /^h[1-6]$/.test(htmlTag(node)) &&
          !insideTable(node) &&
          !!tableText(node),
      )
      const sectionStart = headingNode ? indices.get(headingNode)! + 1 : 0
      const sectionEnd = nextSection < 0 ? nodes.length : nextSection
      const sectionTables = sourceTables.filter((node) => {
        const index = indices.get(node)!
        return index >= sectionStart && index < sectionEnd && !insideTable(node)
      })
      const tablePosition = sectionTables.indexOf(table)
      const previous = sectionTables[tablePosition - 1]
      const next = sectionTables[tablePosition + 1]
      const subtreeEnd = (node: HtmlNode) => indices.get(descendants(node).at(-1) ?? node)! + 1
      const captureNotes = (start: number, end: number, shared: boolean): HtmlTableNote[] =>
        nodes
          .slice(start, end)
          .filter((node) => ['p', 'aside', 'small'].includes(htmlTag(node)) && !insideTable(node))
          .map((node) => ({ ...unit(node), ...(shared ? { shared: true as const } : {}) }))
          .filter((note) => note.text)
      // Text before the first table may apply to the heading's whole section;
      // inter-table text may be either a preceding footnote or a following intro.
      const leading = sectionTables[0]
        ? captureNotes(sectionStart, indices.get(sectionTables[0])!, sectionTables.length > 1)
        : []
      const preceding = previous ? captureNotes(subtreeEnd(previous), offset, true) : []
      const following = captureNotes(
        subtreeEnd(table),
        next ? indices.get(next)! : sectionEnd,
        !!next,
      )
      const notes = [
        ...new Map(
          [...leading, ...preceding, ...following].map((note) => [note.locator, note]),
        ).values(),
      ]
      if (
        notes.length > MAX_NOTES ||
        notes.some((note) => note.text.length > MAX_TEXT) ||
        notes.reduce((length, note) => length + note.text.length, 0) > MAX_NOTE_TEXT
      )
        blockers.push(
          'Context notes exceed the supported bounds (20 notes, 2,000 characters each, 20,000 total). Capture a smaller complete section; notes are not truncated.',
        )
      if (notes.length)
        warnings.push(
          'Text outside the table may define dates, units or exceptions. Review the captured notes.',
        )
      if (notes.some((note) => note.shared))
        warnings.push(
          'Context shared by neighboring tables has ambiguous ownership. It is preserved without inferring table-specific units, dates or exceptions.',
        )
      if (!caption && !heading)
        warnings.push('No caption or preceding heading; the table context is not stated.')
      if (pagination)
        blockers.push(
          'Active next/load-more control: this capture does not prove complete website coverage.',
        )
      if (
        !('sourceCodeLocation' in table) ||
        !table.sourceCodeLocation ||
        !('endTag' in table.sourceCodeLocation) ||
        !table.sourceCodeLocation.endTag
      )
        blockers.push('The table has no closing tag; the captured HTML may be truncated.')
      if (insideTable(table) || sub.some((node) => htmlTag(node) === 'table'))
        blockers.push('Nested tables are unsupported; choose a flat data table.')
      if (htmlAttr(table, 'role') === 'presentation' || htmlAttr(table, 'role') === 'none')
        blockers.push('Layout/presentation tables are unsupported.')
      if ([table, ...sub].some(hidden))
        blockers.push('Hidden table content prevents a trustworthy visible-table capture.')
      if (
        sub.some(
          (node) =>
            ['td', 'th'].includes(htmlTag(node)) &&
            'attrs' in node &&
            node.attrs.some((a) => ['rowspan', 'colspan'].includes(a.name)),
        )
      )
        blockers.push(
          'Rowspan/colspan cells are unsupported; choose an unmerged rectangular table.',
        )
      if (sub.some((node) => htmlTag(node) === 'tfoot'))
        blockers.push(
          'A table footer needs an explicit data/summary decision; it is not silently omitted.',
        )
      const sourceRows = sub.filter(
        (node) =>
          htmlTag(node) === 'tr' && !descendants(node).some((child) => htmlTag(child) === 'table'),
      )
      const cells = sourceRows.map((row) =>
        children(row).filter((n) => ['td', 'th'].includes(htmlTag(n))),
      )
      const first = cells[0] ?? []
      const headers = first.map(unit)
      if (first.length < 2) blockers.push('Expected at least two explicit column names.')
      if (
        headers.some((header) => !header.text) ||
        new Set(headers.map((h) => h.text.toLowerCase())).size !== headers.length
      )
        blockers.push('Blank or duplicate column names are ambiguous.')
      if (headers.some((header) => header.text.toLowerCase() === '_infomonk_record_id'))
        blockers.push(
          'The _infomonk_record_id heading is reserved for the hidden evidence helper; rename the source column before conversion.',
        )
      if (first.some((n) => htmlTag(n) === 'th') && first.some((n) => htmlTag(n) === 'td'))
        blockers.push(
          'The first row mixes header and data cells; confirm a flat header row instead.',
        )
      const headerNeedsConfirmation = first.length > 0 && first.every((n) => htmlTag(n) === 'td')
      if (headerNeedsConfirmation)
        warnings.push(
          'The first row uses data cells. Confirm that it contains column names before conversion.',
        )
      if (cells.slice(1).some((row) => row.length !== first.length))
        blockers.push('Rows have missing/extra cells; incomplete rows are not padded or truncated.')
      if (cells.slice(1).some((row) => row.every((n, i) => tableText(n) === headers[i]?.text)))
        blockers.push(
          'A repeated header appears among the data rows; no rows are silently deleted.',
        )
      if (cells.slice(1).some((row) => row.length && row.every((n) => htmlTag(n) === 'th')))
        blockers.push('Multiple header rows are unsupported without an explicit schema decision.')
      const rows = cells.slice(1).map((row, index) => ({
        locator: htmlPath(sourceRows[index + 1]),
        cells: row.map(unit),
      }))
      const totalCells = cells.reduce((sum, row) => sum + row.length, 0)
      if (totalCells > MAX_CELLS)
        blockers.push(
          'The table exceeds the 100,000-cell bound; split the source without truncation.',
        )
      if (cells.flat().some((node) => tableText(node).length > MAX_TEXT))
        blockers.push('A cell exceeds the supported 2,000-character bound.')
      const advertised = htmlAttr(table, 'data-total-rows')
      const ariaRows = htmlAttr(table, 'aria-rowcount')
      if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) !== rows.length))
        blockers.push('Advertised total differs from captured body rows; coverage is incomplete.')
      if (ariaRows && (!/^\d+$/.test(ariaRows) || Number(ariaRows) !== cells.length))
        blockers.push('ARIA total differs from captured rows; the grid may be partial or virtual.')
      if (htmlAttr(table, 'aria-busy') === 'true' || htmlAttr(table, 'data-virtual') === 'true')
        blockers.push(
          'The table is busy or virtual; static capture cannot establish full coverage.',
        )
      const columns = headers.map((header, index) => ({ ...header, id: `column_${index + 1}` }))
      const id = `html_${digest(JSON.stringify([caption, heading, headers.map((h) => h.text)])).slice(0, 24)}`
      units.push(...headers, ...rows.flatMap((row) => row.cells), ...notes)
      if (headingNode) units.push(unit(headingNode))
      if (captionNode) units.push(unit(captionNode))
      return {
        id,
        name,
        locator: htmlPath(table),
        caption,
        heading,
        columns,
        rows,
        rowCount: rows.length,
        headerNeedsConfirmation,
        notes,
        pagination,
        supported: blockers.length === 0,
        blockers,
        warnings,
      }
    })
  for (const table of tables) {
    if (tables.filter((other) => other.id === table.id).length > 1) {
      table.blockers.push(
        'Multiple tables share the same context and columns; table identity is ambiguous.',
      )
      table.supported = false
    }
  }
  if (!tables.length)
    issues.push(
      'No static HTML tables were found. A script-rendered page needs a complete captured source or reviewed public endpoint.',
    )
  const uniqueUnits = [...new Map(units.map((value) => [value.locator, value])).values()]
  return {
    method: HTML_TABLE_METHOD,
    sourceVersion: digest(bytes),
    tables,
    units: uniqueUnits,
    issues,
  }
}

/** Convert all source rows of explicit tables, retaining source text and requiring stable keys. */
export function htmlTablesDataset(
  parsed: ParsedHtmlTables,
  selections: HtmlTableSelection[],
  source: Omit<Evidence, 'locator' | 'excerpt' | 'method'>,
): ResearchDataset {
  if (source.sourceVersion !== parsed.sourceVersion)
    throw new Error('HTML source version does not match the parsed snapshot.')
  if (!selections.length || new Set(selections.map((s) => s.tableId)).size !== selections.length)
    throw new Error('Choose distinct HTML tables.')
  const names = new Set<string>()
  const issues: string[] = [...parsed.issues]
  const tables = selections.map((selection): ResearchTable => {
    const table = parsed.tables.find((candidate) => candidate.id === selection.tableId)
    if (!table)
      throw new Error('Selected HTML table no longer matches its confirmed context and columns.')
    if (!table.supported) throw new Error(table.blockers.join(' '))
    if (table.headerNeedsConfirmation && selection.confirmFirstRowAsHeader !== true)
      throw new Error('Confirm that the first row contains column names.')
    if (
      !selection.keyColumns.length ||
      new Set(selection.keyColumns).size !== selection.keyColumns.length
    )
      throw new Error('Choose distinct stable key columns.')
    const keys = selection.keyColumns.map((key) => {
      const index = table.columns.findIndex((column) => column.id === key)
      if (index < 0) throw new Error('A chosen key column is absent from this table.')
      return index
    })
    const identities = new Set<string>()
    let name =
      table.name
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .trim()
        .slice(0, 31) || 'Table'
    const stem = name
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++)
      name = `${stem.slice(0, 31 - String(suffix).length - 1)} ${suffix}`
    names.add(name.toLowerCase())
    issues.push(...table.warnings.map((warning) => `${table.name}: ${warning}`))
    issues.push(
      ...table.notes.map(
        (note) =>
          `${table.name}: Outside-table context (${note.locator}): ${note.shared ? '[Shared context; table ownership is ambiguous] ' : ''}${note.text}`,
      ),
    )
    const rows = table.rows.map((row) => {
      const keyValues = keys.map((index) => row.cells[index].text)
      if (keyValues.some((value) => !value))
        throw new Error('Blank source keys cannot identify maintained rows.')
      const identity = JSON.stringify(keyValues)
      if (identities.has(identity))
        throw new Error('Duplicate chosen source keys; no records are silently merged.')
      identities.add(identity)
      return {
        id: digest(
          JSON.stringify([source.sourceId, table.id, selection.keyColumns, keyValues]),
        ).slice(0, 24),
        cells: Object.fromEntries(
          table.columns.map((column, index) => {
            const value = row.cells[index]
            return [
              column.id,
              {
                value: value.text || null,
                missingReason: value.text ? null : 'Blank source cell',
                evidence: [
                  { ...source, locator: value.locator, excerpt: value.text, method: parsed.method },
                ],
                issues: [],
                origin: 'external' as const,
              },
            ]
          }),
        ),
      }
    })
    return {
      id: table.id,
      name,
      rowMeaning: `One source row from ${table.name}; identity uses ${keys.map((index) => table.columns[index].text).join(' + ')}`,
      columns: table.columns.map((column) => ({
        id: column.id,
        name: column.text,
        type: 'text' as const,
      })),
      rows,
    }
  })
  return { schemaVersion: 1, tables, issues }
}
