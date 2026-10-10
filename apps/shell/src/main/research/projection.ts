import JSZip from 'jszip'
import { sheetCsvToXlsxBuffer } from '@genoffice/xlsx-gateway/gateway/csv-import'
import { encodeXlsxEscapes } from '@genoffice/xlsx-gateway/gateway/xlsx-escapes'
import type { ResearchDataset } from '../../shared/research-api'

export async function projectDataset(
  dataset: ResearchDataset,
  workflowId: string,
  revision: number,
): Promise<Buffer> {
  const tables = dataset.tables.length
    ? dataset.tables
    : [{ id: 'empty', name: 'Empty', columns: [], rows: [] }]
  let zip: JSZip | undefined
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i]
    // Stable machine column IDs survive edits to display labels in the review UI.
    const rows = [
      [...table.columns.map((c) => c.id), '_infomonk_record_id'],
      ...table.rows.map((r) => [...table.columns.map((c) => r.cells[c.id]?.value ?? ''), r.id]),
    ]
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const part = await JSZip.loadAsync(await sheetCsvToXlsxBuffer(csv, table.name))
    let xml = await part.file('xl/worksheets/sheet1.xml')!.async('string')
    // CSV inference is deliberately broad. Typed text and opaque IDs must always stay strings.
    for (let row = 0; row < rows.length; row++)
      for (let column = 0; column < rows[row].length; column++) {
        const value = rows[row][column]
        let label = ''
        for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26))
          label = String.fromCharCode(65 + ((n - 1) % 26)) + label
        const address = `${label}${row + 1}`
        const escaped = encodeXlsxEscapes(String(value))
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
        const replacement =
          typeof value === 'number'
            ? `<c r="${address}"><v>${value}</v></c>`
            : `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${escaped}</t></is></c>`
        xml = xml.replace(new RegExp(`<c r="${address}"(?: [^>]*)?>[\\s\\S]*?</c>`), replacement)
      }
    xml = xml.replace(
      '<sheetData>',
      `<cols>${table.columns.map((c, index) => `<col min="${index + 1}" max="${index + 1}" width="${c.id === 'supplier' || c.id === 'description' || c.id === 'country' ? 26 : 16}" customWidth="1"/>`).join('')}<col min="${table.columns.length + 1}" max="${table.columns.length + 1}" hidden="1" width="12" customWidth="1"/></cols><sheetData>`,
    )
    if (!zip) {
      zip = part
      zip.file('xl/worksheets/sheet1.xml', xml)
    } else {
      zip.file(`xl/worksheets/sheet${i + 1}.xml`, xml)
      const workbook = await zip.file('xl/workbook.xml')!.async('string')
      zip.file(
        'xl/workbook.xml',
        workbook.replace(
          '</sheets>',
          `<sheet name="${table.name}" sheetId="${i + 1}" r:id="infomonk${i}"/></sheets>`,
        ),
      )
      const rels = await zip.file('xl/_rels/workbook.xml.rels')!.async('string')
      zip.file(
        'xl/_rels/workbook.xml.rels',
        rels.replace(
          '</Relationships>',
          `<Relationship Id="infomonk${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/></Relationships>`,
        ),
      )
      const types = await zip.file('[Content_Types].xml')!.async('string')
      zip.file(
        '[Content_Types].xml',
        types.replace(
          '</Types>',
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
        ),
      )
    }
  }
  zip!.file(
    'infomonk/research.json',
    JSON.stringify({
      version: 1,
      workflowId,
      revision,
      dataset,
      attribution: dataset.tables.some((t) =>
        t.rows.some((r) =>
          Object.values(r.cells).some((c) =>
            c.evidence.some((e) => e.method === 'worldbank-SP.POP.TOTL-v1'),
          ),
        ),
      )
        ? 'World Bank, World Development Indicators, SP.POP.TOTL; original URLs and retrieval times are recorded in cell evidence. CC BY 4.0 subject to source terms. Human changes are labeled manual.'
        : 'User-provided document snapshots; source versions and locators are recorded in cell evidence. Human changes are labeled manual.',
      tables: dataset.tables.map((t) => ({ id: t.id, name: t.name, columns: t.columns })),
    }),
  )
  const types = await zip!.file('[Content_Types].xml')!.async('string')
  zip!.file(
    '[Content_Types].xml',
    types.replace(
      '</Types>',
      '<Override PartName="/infomonk/research.json" ContentType="application/json"/></Types>',
    ),
  )
  const rels = await zip!.file('_rels/.rels')!.async('string')
  zip!.file(
    '_rels/.rels',
    rels.replace(
      '</Relationships>',
      '<Relationship Id="infomonkResearch" Type="urn:infomonk:research" Target="infomonk/research.json"/></Relationships>',
    ),
  )
  return zip!.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
