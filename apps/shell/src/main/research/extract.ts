import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import { parseDocx } from '@genoffice/docx-engine'
import { readPdfText } from '../../../../pdf/src/main/read-text'
import type {
  Evidence,
  ResearchCell,
  ResearchDataset,
  ResearchTable,
  ResearchConfig,
} from '../../shared/research-api'

export const PROCESSING_VERSION = 'quotes-1/worldbank-1/schema-1'
export const processingVersion = (config: ResearchConfig) =>
  config.kind === 'jobs' ? 'bermuda-jobs-2/schema-2' : PROCESSING_VERSION
export const quoteColumns: ResearchTable['columns'] = [
  { id: 'quote_id', name: 'Quote ID', type: 'text' },
  { id: 'supplier', name: 'Supplier', type: 'text' },
  { id: 'date', name: 'Date', type: 'date' },
  { id: 'currency', name: 'Currency', type: 'text' },
  { id: 'total', name: 'Total', type: 'number' },
  { id: 'country_code', name: 'Country code', type: 'text' },
]
export const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
export interface ParsedUnit {
  locator: string
  text: string
  fields?: Record<string, { locator: string; text: string }>
}
export interface ParsedSource {
  units: ParsedUnit[]
  method: string
}
export async function parseSource(bytes: Buffer, name: string): Promise<ParsedSource> {
  let units: ParsedUnit[]
  const extension = extname(name).toLowerCase()
  if (extension === '.pdf') {
    const doc = await readPdfText(bytes, { charBudget: 200_000 })
    if (doc.truncated || doc.pages.some((p) => !p.hasTextLayer))
      throw new Error(
        'Incomplete text coverage: scanned/empty or oversized PDF. OCR is outside this extractor.',
      )
    units = doc.pages.flatMap((p) =>
      p.text.split('\n').map((text, i) => ({ locator: `PDF page ${p.page}, line ${i + 1}`, text })),
    )
  } else if (extension === '.docx') {
    const doc = await parseDocx(bytes)
    units = doc.blocks.flatMap((block) => {
      if (block.hidden) return []
      const anchor = `DOCX body element ${(block.docxIndex ?? -1) + 1}`
      if (block.type === 'table') {
        const rows = (block.table?.rows ?? []).map((row) =>
          row.map((cell) => cell.paras.join(' ').trim()),
        )
        const isItems = rows[0]?.join('|').toLowerCase() === 'item|description|quantity|unit price'
        return rows.map((row, index): ParsedUnit => {
          const locator = `${anchor}, table row ${index + 1}`
          if (
            row.length === 2 &&
            /^(Quote ID|Supplier|Date|Currency|Total|Country code):?$/i.test(row[0])
          )
            return { locator: `${locator}, cell 2`, text: `${row[0].replace(/:$/, '')}: ${row[1]}` }
          if (isItems && index > 0 && row.length === 4)
            return {
              locator,
              text: `Item ${row[0]} | ${row.slice(1).join(' | ')}`,
              fields: Object.fromEntries(
                ['description', 'quantity', 'unit_price'].map((field, i) => [
                  field,
                  { locator: `${locator}, cell ${i + 2}`, text: row[i + 1] },
                ]),
              ),
            }
          return { locator, text: row.join(' | ') }
        })
      }
      return [{ locator: anchor, text: (block.runs ?? []).map((run) => run.text).join('') }]
    })
  } else if (['.txt', '.md'].includes(extension)) {
    units = new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .split(/\r?\n/)
      .map((text, i) => ({ locator: `Text line ${i + 1}`, text }))
  } else throw new Error('Supported quote inputs: text PDF, DOCX, Markdown or UTF-8 text.')
  if (!units.length || units.reduce((n, u) => n + u.text.length, 0) > 200_000)
    throw new Error('Empty or oversized document.')
  return { units, method: `inherited-${extension.slice(1)}+supplier-quote-v1` }
}
export function cell(
  value: string | number | null,
  evidence: Evidence[] = [],
  missingReason: string | null = null,
  issues: string[] = [],
  origin: ResearchCell['origin'] = 'internal',
): ResearchCell {
  return {
    value,
    evidence,
    missingReason: value === null ? (missingReason ?? 'Not stated in source') : null,
    issues,
    origin,
  }
}
export function extractQuote(
  parsed: ParsedSource,
  source: Omit<Evidence, 'locator' | 'excerpt' | 'method'>,
  fields: string[],
): ResearchDataset {
  if (parsed.units.filter((u) => /^Supplier Quote\s*$/i.test(u.text.trim())).length !== 1)
    throw new Error(
      'Unsupported document family. Expected exactly one Supplier Quote heading and labeled fields.',
    )
  const definitions: Record<string, RegExp> = {
    quote_id: /^Quote ID:\s*(.*)$/i,
    supplier: /^Supplier:\s*(.*)$/i,
    date: /^Date:\s*(.*)$/i,
    currency: /^Currency:\s*(.*)$/i,
    total: /^Total:\s*(.*)$/i,
    country_code: /^Country code:\s*(.*)$/i,
  }
  const all: Record<string, ResearchCell> = {}
  for (const [id, pattern] of Object.entries(definitions)) {
    const matches = parsed.units.filter((u) => pattern.test(u.text.trim()))
    const values = [
      ...new Set(matches.map((u) => u.text.trim().match(pattern)![1].trim()).filter(Boolean)),
    ]
    const evidence = matches.map((u) => ({
      ...source,
      locator: u.locator,
      excerpt: u.text,
      method: parsed.method,
    }))
    let value: string | number | null = values[0] ?? null
    const issues: string[] = []
    if (value !== null && String(value).length > 2000) {
      value = null
      issues.push('Field exceeds the supported 2,000-character bound')
    }
    if (values.length > 1) {
      value = null
      issues.push('Conflicting labeled values')
    }
    if (value !== null && id === 'total') {
      if (!/^\d+(?:\.\d{1,2})?$/.test(String(value)) || !Number.isFinite(Number(value))) {
        value = null
        issues.push('Expected a nonnegative decimal total without currency symbols')
      } else value = Number(value)
    }
    if (
      value !== null &&
      id === 'date' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
        !Number.isFinite(Date.parse(String(value))) ||
        new Date(String(value)).toISOString().slice(0, 10) !== value)
    ) {
      value = null
      issues.push('Expected a valid ISO date')
    }
    if (
      value !== null &&
      ['currency', 'country_code'].includes(id) &&
      !/^[A-Z]{3}$/.test(String(value))
    ) {
      value = null
      issues.push('Expected a three-letter uppercase code')
    }
    all[id] = cell(value, evidence, issues.length ? issues.join('; ') : null, issues)
  }
  const key = all.quote_id.value
  // Business keys deduplicate repeated quotes; missing keys use immutable source identity.
  const rowId = hash(`quote:${key === null ? source.sourceVersion : String(key)}`).slice(0, 24)
  const columns = quoteColumns.filter((c) => fields.includes(c.id))
  const quote: ResearchTable = {
    id: 'quotes',
    name: 'Quotes',
    rowMeaning: 'One supplier quote per Quote ID',
    columns,
    rows: [{ id: rowId, cells: Object.fromEntries(columns.map((c) => [c.id, all[c.id]])) }],
  }
  const lines: ResearchTable = {
    id: 'line_items',
    name: 'Line items',
    rowMeaning: 'One numbered item belonging to a quote',
    columns: [
      { id: 'quote_id', name: 'Quote ID', type: 'text' },
      { id: 'description', name: 'Description', type: 'text' },
      { id: 'quantity', name: 'Quantity', type: 'number' },
      { id: 'unit_price', name: 'Unit price', type: 'number' },
    ],
    rows: [],
  }
  for (const unit of parsed.units) {
    const m = unit.text
      .trim()
      .match(/^Item\s+(\d+)\s*\|\s*([^|]+)\|\s*(\d+(?:\.\d+)?)\s*\|\s*(\d+(?:\.\d{1,2})?)\s*$/i)
    if (!m) continue
    const evidence = [
      { ...source, locator: unit.locator, excerpt: unit.text, method: parsed.method },
    ]
    const fieldEvidence = (field: string) =>
      unit.fields?.[field]
        ? [
            {
              ...source,
              locator: unit.fields[field].locator,
              excerpt: unit.fields[field].text,
              method: parsed.method,
            },
          ]
        : evidence
    if (
      lines.rows.length >= 1000 ||
      !Number.isFinite(Number(m[3])) ||
      !Number.isFinite(Number(m[4]))
    )
      throw new Error(
        'Line-item coverage exceeds supported bounds (1,000 items per document, finite numbers).',
      )
    lines.rows.push({
      id: hash(`${rowId}:item:${m[1]}`).slice(0, 24),
      cells: {
        quote_id: all.quote_id,
        description: cell(m[2].trim(), fieldEvidence('description')),
        quantity: cell(Number(m[3]), fieldEvidence('quantity')),
        unit_price: cell(Number(m[4]), fieldEvidence('unit_price')),
      },
    })
  }
  const issues = parsed.units
    .filter(
      (u) =>
        /^Item\s+\d+/i.test(u.text.trim()) &&
        !/^Item\s+\d+\s*\|\s*[^|]+\|\s*\d+(?:\.\d+)?\s*\|\s*\d+(?:\.\d{1,2})?\s*$/i.test(
          u.text.trim(),
        ),
    )
    .map((u) => `Unparsed line item at ${u.locator}`)
  return { schemaVersion: 1, tables: [quote, lines], issues }
}
export function mergeDatasets(datasets: ResearchDataset[]): ResearchDataset {
  const result: ResearchDataset = {
    schemaVersion: 1,
    tables: [],
    issues: datasets.flatMap((d) => d.issues),
  }
  for (const dataset of datasets)
    for (const table of dataset.tables) {
      let destination = result.tables.find((t) => t.id === table.id)
      if (!destination) {
        destination = { ...table, rows: [] }
        result.tables.push(destination)
      }
      for (const row of table.rows) {
        const prior = destination.rows.find((r) => r.id === row.id)
        if (!prior) {
          destination.rows.push(structuredClone(row))
          continue
        }
        for (const [column, incoming] of Object.entries(row.cells)) {
          const old = prior.cells[column]
          if (old.value !== incoming.value) {
            old.value = null
            old.missingReason = 'Duplicate business key has conflicting source values'
            old.issues.push(old.missingReason)
          }
          old.evidence.push(
            ...incoming.evidence.filter(
              (e) =>
                !old.evidence.some(
                  (o) => o.sourceVersion === e.sourceVersion && o.locator === e.locator,
                ),
            ),
          )
        }
      }
    }
  return result
}
