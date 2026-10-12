import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { publicHtml, htmlTag, htmlText } from '@genoffice/electron-utils/public-html'
import { htmlTablesDataset, parseHtmlTables } from '../src/main/research/html-tables'
import { projectDataset } from '../src/main/research/projection'

const html = (value: string) => Buffer.from(`<!doctype html><html><body>${value}</body></html>`)
const source = (version: string) => ({
  sourceId: 'fixed-official-source',
  sourceVersion: version,
  sourceName: 'Captured official table',
  uri: 'https://example.test/catalogue',
  retrievedAt: '2026-10-11T12:00:00.000Z',
})
function dataset(value: string) {
  const parsed = parseHtmlTables(html(value))
  return htmlTablesDataset(
    parsed,
    [{ tableId: parsed.tables[0].id, keyColumns: ['column_1'] }],
    source(parsed.sourceVersion),
  )
}
const table = (rows: string, header = '<th>ID</th><th>Value</th>', attrs = '') =>
  `<h2>Published records</h2><table ${attrs}><tr>${header}</tr>${rows}</table>`

describe('whole captured HTML tables', () => {
  it('retains all 205 source rows, literal IDs/amounts/formulas, missing values and exact evidence', async () => {
    const rows = Array.from(
      { length: 205 },
      (_, i) =>
        `<tr><td>${String(i).padStart(6, '0')}</td><td>${i === 3 ? '' : i === 17 ? '=2+2' : `Item ${i}`}</td><td>${((i % 10) + 0.25).toFixed(2)}</td></tr>`,
    ).join('')
    const captured = html(table(rows, '<th>SKU</th><th>Description</th><th>Amount</th>'))
    const parsed = parseHtmlTables(captured)
    expect(parsed.tables[0]).toMatchObject({
      supported: true,
      rowCount: 205,
      heading: 'Published records',
    })
    const converted = htmlTablesDataset(
      parsed,
      [{ tableId: parsed.tables[0].id, keyColumns: ['column_1'] }],
      source(parsed.sourceVersion),
    )
    const records = converted.tables[0].rows
    expect(records).toHaveLength(205)
    expect(records[0].cells.column_1.value).toBe('000000')
    expect(records[204].cells.column_1.value).toBe('000204')
    expect(records[204].cells.column_3.value).toBe('4.25')
    expect(records.reduce((sum, row) => sum + Number(row.cells.column_3.value), 0)).toBe(961.25)
    expect(records[3].cells.column_2).toMatchObject({
      value: null,
      missingReason: 'Blank source cell',
      origin: 'external',
    })
    expect(records[17].cells.column_2.value).toBe('=2+2')
    for (const row of records)
      for (const cell of Object.values(row.cells)) {
        expect(cell.evidence).toHaveLength(1)
        const proof = cell.evidence[0]
        expect(proof.sourceVersion).toBe(parsed.sourceVersion)
        expect(
          parsed.units.some(
            (unit) => unit.locator === proof.locator && unit.text === proof.excerpt,
          ),
        ).toBe(true)
      }
    const zip = await JSZip.loadAsync(await projectDataset(converted, 'workflow', 1))
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string')
    expect(sheet).toContain('=2+2</t>')
    expect(sheet).not.toContain('<f>2+2</f>')
    expect(sheet).toContain('000204</t>')
    const metadata = JSON.parse(await zip.file('infomonk/research.json')!.async('string'))
    expect(metadata.dataset.tables[0].rows).toHaveLength(205)
  })

  it('requires confirmed td headers, records outside-year notes and preserves inline numeric/ordinal text', () => {
    const parsed = parseHtmlTables(
      html(
        '<h2>2026</h2><table><tr><td>Holiday</td><td>Date</td></tr><tr><td>Boxing Day</td><td>Saturday, 26<sup>th</sup> December</td></tr></table><p>Observed-day exception: Monday, 28th December.</p>',
      ),
    )
    expect(parsed.tables[0]).toMatchObject({
      supported: true,
      heading: '2026',
      headerNeedsConfirmation: true,
    })
    expect(parsed.tables[0].rows[0].cells[1].text).toBe('Saturday, 26th December')
    expect(parsed.tables[0].notes[0].text).toBe('Observed-day exception: Monday, 28th December.')
    expect(() =>
      htmlTablesDataset(
        parsed,
        [{ tableId: parsed.tables[0].id, keyColumns: ['column_1'] }],
        source(parsed.sourceVersion),
      ),
    ).toThrow('Confirm')
    const result = htmlTablesDataset(
      parsed,
      [{ tableId: parsed.tables[0].id, keyColumns: ['column_1'], confirmFirstRowAsHeader: true }],
      source(parsed.sourceVersion),
    )
    expect(result.issues.join(' ')).toContain('outside')
    expect(result.issues).toContain(
      `2026: Outside-table context (${parsed.tables[0].notes[0].locator}): Observed-day exception: Monday, 28th December.`,
    )
    expect(result.tables[0].rows[0].cells.column_2.value).toBe('Saturday, 26th December')
    expect(
      dataset(table('<tr><td>1</td><td>1,<span>234</span>.50<br>other text</td></tr>')).tables[0]
        .rows[0].cells.column_2.value,
    ).toBe('1,234.50 other text')
    expect(parsed.units.some((unit) => unit.text.includes('Observed-day exception'))).toBe(true)
  })

  it('retains actual context changes in accepted metadata while source row keys stay stable', async () => {
    const content = table('<tr><td>A</td><td>Saturday, 26th December</td></tr>')
    const before = dataset(content + '<p>Observed date is Monday, 28th December.</p>')
    const after = dataset(content + '<p>Observed date corrected to Tuesday, 29th December.</p>')
    expect(before.tables[0].rows[0].id).toBe(after.tables[0].rows[0].id)
    expect(before.issues.join(' ')).toContain('Monday, 28th December')
    expect(after.issues.join(' ')).toContain('Tuesday, 29th December')
    expect(after.issues.join(' ')).not.toContain('Monday, 28th December')
    const metadata = JSON.parse(
      await (
        await JSZip.loadAsync(await projectDataset(after, 'workflow', 2))
      )
        .file('infomonk/research.json')!
        .async('string'),
    )
    expect(metadata.dataset.issues.join(' ')).toContain('Tuesday, 29th December')
    expect(metadata.dataset.issues.join(' ')).toContain('HTML /')
  })

  it('retains context before the table with exact evidence instead of losing units and provisional warnings', () => {
    const parsed = parseHtmlTables(
      html(
        '<h2>Population</h2><p>Units: thousands; provisional values.</p><table><tr><th>Country</th><th>Population</th></tr><tr><td>BM</td><td>64.0</td></tr></table>',
      ),
    )
    expect(parsed.tables[0].notes).toEqual([
      { text: 'Units: thousands; provisional values.', locator: parsed.tables[0].notes[0].locator },
    ])
    const result = htmlTablesDataset(
      parsed,
      [{ tableId: parsed.tables[0].id, keyColumns: ['column_1'] }],
      source(parsed.sourceVersion),
    )
    expect(result.issues.join(' ')).toContain('Units: thousands; provisional values.')
    expect(result.tables[0].rows[0].cells.column_2.value).toBe('64.0')
    expect(
      parsed.units.some(
        (unit) =>
          unit.locator === parsed.tables[0].notes[0].locator &&
          unit.text === 'Units: thousands; provisional values.',
      ),
    ).toBe(true)
  })

  it('bounds neighboring table context and labels inter-table ownership as ambiguous', () => {
    const parsed = parseHtmlTables(
      html(
        '<h2>Pricing</h2><p>Prices are provisional.</p><table><caption>Table A</caption><tr><th>ID</th><th>Amount</th></tr><tr><td>A</td><td>10</td></tr></table><p>A units: USD.</p><table><caption>Table B</caption><tr><th>ID</th><th>Amount</th></tr><tr><td>B</td><td>20</td></tr></table><p>B units: CAD.</p>',
      ),
    )
    expect(parsed.tables[0].notes.map((note) => note.text)).toEqual([
      'Prices are provisional.',
      'A units: USD.',
    ])
    expect(parsed.tables[0].notes.every((note) => note.shared === true)).toBe(true)
    expect(parsed.tables[0].notes.some((note) => note.text.includes('CAD'))).toBe(false)
    expect(parsed.tables[1].notes.map((note) => note.text)).toEqual([
      'Prices are provisional.',
      'A units: USD.',
      'B units: CAD.',
    ])
    expect(parsed.tables[1].notes.find((note) => note.text.includes('CAD'))?.shared).toBeUndefined()
    expect(
      parsed.tables.every((table) => table.warnings.join(' ').includes('ambiguous ownership')),
    ).toBe(true)
    const result = htmlTablesDataset(
      parsed,
      parsed.tables.map((table) => ({ tableId: table.id, keyColumns: ['column_1'] })),
      source(parsed.sourceVersion),
    )
    expect(
      result.issues.some(
        (issue) => issue.startsWith('Table A: Outside-table context') && issue.includes('CAD'),
      ),
    ).toBe(false)
    expect(
      result.issues.some(
        (issue) =>
          issue.startsWith('Table B: Outside-table context') &&
          issue.includes('[Shared context; table ownership is ambiguous] A units: USD.'),
      ),
    ).toBe(true)
    expect(parsed.units.filter((unit) => unit.text === 'A units: USD.')).toHaveLength(1)
  })

  it('blocks oversized context instead of truncating or dropping the note meaning', () => {
    const longNote = 'N'.repeat(2001)
    const parsed = parseHtmlTables(
      html(table('<tr><td>A</td><td>1</td></tr>') + `<p>${longNote}</p>`),
    )
    expect(parsed.tables[0].supported).toBe(false)
    expect(parsed.tables[0].notes[0].text).toBe(longNote)
    expect(parsed.units.some((unit) => unit.text === longNote)).toBe(true)
    expect(() =>
      htmlTablesDataset(
        parsed,
        [{ tableId: parsed.tables[0].id, keyColumns: ['column_1'] }],
        source(parsed.sourceVersion),
      ),
    ).toThrow('notes are not truncated')
    const many = parseHtmlTables(
      html(
        table('<tr><td>A</td><td>1</td></tr>') +
          Array.from({ length: 21 }, (_, i) => `<p>Exception ${i}</p>`).join(''),
      ),
    )
    expect(many.tables[0].notes).toHaveLength(21)
    expect(many.tables[0].blockers.join(' ')).toContain('Context notes exceed')
  })

  it('keeps stable row IDs when page decoration, snapshot versions, paths and row ordering change', () => {
    const first = dataset(
      table('<tr><td>0001</td><td>First</td></tr><tr><td>0002</td><td>Second</td></tr>'),
    )
    const second = dataset(
      '<aside>Different banner</aside>' +
        table('<tr><td>0002</td><td>Second</td></tr><tr><td>0001</td><td>First changed</td></tr>') +
        '<footer>New decoration</footer>',
    )
    const ids = (result: ReturnType<typeof dataset>) =>
      Object.fromEntries(result.tables[0].rows.map((r) => [r.cells.column_1.value, r.id]))
    expect(first.tables[0].id).toBe(second.tables[0].id)
    expect(ids(first)).toEqual(ids(second))
    expect(first.tables[0].rows[0].cells.column_2.evidence[0].sourceVersion).not.toBe(
      second.tables[0].rows[1].cells.column_2.evidence[0].sourceVersion,
    )
    expect(first.tables[0].rows[0].cells.column_2.evidence[0].locator).not.toBe(
      second.tables[0].rows[1].cells.column_2.evidence[0].locator,
    )
  })

  it('discovers multiple contextual tables in one source and refuses ambiguous table identities', () => {
    const parsed = parseHtmlTables(
      html(
        '<h2>2026</h2><table><tr><th>ID</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table><h2>2027</h2><table><tr><th>ID</th><th>Value</th></tr><tr><td>A</td><td>2</td></tr></table>',
      ),
    )
    expect(parsed.tables).toHaveLength(2)
    const selected = htmlTablesDataset(
      parsed,
      parsed.tables.map((table) => ({ tableId: table.id, keyColumns: ['column_1'] })),
      source(parsed.sourceVersion),
    )
    expect(selected.tables.map((t) => t.name)).toEqual(['2026', '2027'])
    expect(selected.tables[0].rows[0].id).not.toBe(selected.tables[1].rows[0].id)
    const ambiguous = parseHtmlTables(
      html(
        '<table><tr><th>ID</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr></table><table><tr><th>ID</th><th>Value</th></tr><tr><td>B</td><td>2</td></tr></table>',
      ),
    )
    expect(
      ambiguous.tables.every(
        (t) => !t.supported && t.blockers.join(' ').includes('identity is ambiguous'),
      ),
    ).toBe(true)
  })

  it.each([
    ['ragged', '<tr><td>A</td></tr>', '<th>ID</th><th>Value</th>', '', 'missing/extra'],
    [
      'spanned',
      '<tr><td colspan="2">A</td></tr>',
      '<th>ID</th><th>Value</th>',
      '',
      'Rowspan/colspan',
    ],
    [
      'duplicate headers',
      '<tr><td>A</td><td>B</td></tr>',
      '<th>Name</th><th>name</th>',
      '',
      'column names',
    ],
    ['blank header', '<tr><td>A</td><td>B</td></tr>', '<th></th><th>Name</th>', '', 'column names'],
    [
      'reserved heading',
      '<tr><td>A</td><td>B</td></tr>',
      '<th>ID</th><th>_infomonk_record_id</th>',
      '',
      'reserved',
    ],
    [
      'case-varied reserved heading',
      '<tr><td>A</td><td>B</td></tr>',
      '<th>ID</th><th> _INFOMONK_RECORD_ID </th>',
      '',
      'reserved',
    ],
    [
      'repeated header',
      '<tr><td>ID</td><td>Value</td></tr>',
      '<th>ID</th><th>Value</th>',
      '',
      'repeated header',
    ],
    [
      'advertised count',
      '<tr><td>A</td><td>B</td></tr>',
      '<th>ID</th><th>Value</th>',
      'data-total-rows="5"',
      'Advertised total',
    ],
    [
      'virtual count',
      '<tr><td>A</td><td>B</td></tr>',
      '<th>ID</th><th>Value</th>',
      'aria-rowcount="99"',
      'ARIA total',
    ],
    [
      'layout',
      '<tr><td>A</td><td>B</td></tr>',
      '<th>ID</th><th>Value</th>',
      'role="presentation"',
      'Layout',
    ],
    ['hidden', '<tr hidden><td>A</td><td>B</td></tr>', '<th>ID</th><th>Value</th>', '', 'Hidden'],
  ])(
    'refuses %s without deleting, padding or silently truncating source rows',
    (_name, rows, headers, attrs, expected) => {
      const parsed = parseHtmlTables(html(table(rows, headers, attrs)))
      expect(parsed.tables[0].supported).toBe(false)
      expect(parsed.tables[0].blockers.join(' ')).toContain(expected)
      expect(() =>
        htmlTablesDataset(
          parsed,
          [{ tableId: parsed.tables[0].id, keyColumns: ['column_1'] }],
          source(parsed.sourceVersion),
        ),
      ).toThrow(expected)
    },
  )

  it('refuses nested tables, summary footers and incomplete source closure', () => {
    const nested = parseHtmlTables(
      html(
        table(
          '<tr><td>A</td><td><table><tr><th>X</th><th>Y</th></tr><tr><td>B</td><td>C</td></tr></table></td></tr>',
        ),
      ),
    )
    expect(
      nested.tables.every((t) => !t.supported && t.blockers.join(' ').includes('Nested')),
    ).toBe(true)
    const footer = parseHtmlTables(
      html(
        '<table><tr><th>ID</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr><tfoot><tr><td>Total</td><td>1</td></tr></tfoot></table>',
      ),
    )
    expect(footer.tables[0].blockers.join(' ')).toContain('footer')
    const truncated = parseHtmlTables(
      Buffer.from('<table><tr><th>ID</th><th>Value</th></tr><tr><td>A</td><td>1</td></tr>'),
    )
    expect(truncated.tables[0].blockers.join(' ')).toContain('truncated')
  })

  it('blocks active next/load-more controls while accepting a explicitly disabled final-page control', () => {
    const content = table('<tr><td>A</td><td>1</td></tr>')
    for (const control of [
      '<a href="?page=2" rel="next">2</a>',
      '<button>Load more</button>',
      '<a href="?page=2">Next page</a>',
    ]) {
      const parsed = parseHtmlTables(html(content + control))
      expect(parsed.tables[0]).toMatchObject({ supported: false, pagination: true })
      expect(parsed.tables[0].blockers.join(' ')).toContain('complete website coverage')
    }
    expect(
      parseHtmlTables(html(content + '<button disabled>Next</button>')).tables[0].supported,
    ).toBe(true)
    expect(
      parseHtmlTables(
        html(content + '<div role="dialog"><button aria-label="Next image"></button></div>'),
      ).tables[0].supported,
    ).toBe(true)
    expect(
      parseHtmlTables(
        html('<h2>2028</h2><h2></h2>' + content.replace('<h2>Published records</h2>', '')),
      ).tables[0].heading,
    ).toBe('2028')
  })

  it('preserves repeated values until explicit key selection and refuses blank/duplicate keys', () => {
    const repeated = parseHtmlTables(
      html(table('<tr><td>A</td><td>Same</td></tr><tr><td>B</td><td>Same</td></tr>')),
    )
    const convert = (keys: string[]) =>
      htmlTablesDataset(
        repeated,
        [{ tableId: repeated.tables[0].id, keyColumns: keys }],
        source(repeated.sourceVersion),
      )
    expect(convert(['column_1']).tables[0].rows).toHaveLength(2)
    expect(() => convert(['column_2'])).toThrow('Duplicate')
    expect(() => convert([])).toThrow('key columns')
    expect(() => dataset(table('<tr><td></td><td>Blank key</td></tr>'))).toThrow(
      'Blank source keys',
    )
    expect(() =>
      dataset(table('<tr><td>A</td><td>Same</td></tr><tr><td>A</td><td>Same</td></tr>')),
    ).toThrow('Duplicate')
  })

  it('rejects changed snapshot evidence and bounds bytes, encoding, depth and cell length', () => {
    const parsed = parseHtmlTables(html(table('<tr><td>A</td><td>1</td></tr>')))
    expect(() =>
      htmlTablesDataset(
        parsed,
        [{ tableId: parsed.tables[0].id, keyColumns: ['column_1'] }],
        source('0'.repeat(64)),
      ),
    ).toThrow('source version')
    expect(() => parseHtmlTables(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow('2 MiB')
    expect(() => parseHtmlTables(Buffer.from([0xff]))).toThrow()
    expect(() => parseHtmlTables(html('<div>'.repeat(201) + '</div>'.repeat(201)))).toThrow(
      'structure',
    )
    expect(
      parseHtmlTables(
        html(table(`<tr><td>A</td><td>${'X'.repeat(2001)}</td></tr>`)),
      ).tables[0].blockers.join(' '),
    ).toContain('2,000-character')
    expect(
      parseHtmlTables(html('<script>document.write("<table>")</script>')).issues.join(' '),
    ).toContain('No static HTML tables')
  })

  it('opts into shared source locations without changing existing job text behavior', () => {
    const captured = html('<table><tr><td>1<sup>st</sup></td><td>B</td></tr></table>')
    const standard = publicHtml(captured).find((n) => htmlTag(n) === 'table')!
    const located = publicHtml(captured, { sourceCodeLocationInfo: true }).find(
      (n) => htmlTag(n) === 'table',
    )!
    expect(
      'sourceCodeLocation' in standard ? standard.sourceCodeLocation : undefined,
    ).toBeUndefined()
    expect(
      'sourceCodeLocation' in located &&
        located.sourceCodeLocation &&
        'endTag' in located.sourceCodeLocation &&
        located.sourceCodeLocation.endTag,
    ).toBeTruthy()
    const cell = publicHtml(captured).find((n) => htmlTag(n) === 'td')!
    expect(htmlText(cell)).toBe('1 st')
  })
})
