import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import { sheetCsvToXlsxBuffer } from '../../packages/xlsx-gateway/src/gateway/csv-import'

const source = await readFile(new URL('suppliers.tsv', import.meta.url), 'utf8')
const zip = await JSZip.loadAsync(await sheetCsvToXlsxBuffer(source, '\t'))
const entry = 'xl/worksheets/sheet1.xml'
const xml = await zip.file(entry)!.async('string')
zip.file(
  entry,
  xml
    .replace('A1:D6', 'A1:D7')
    .replace(
      '</sheetData>',
      '<row r="7"><c r="B7" t="inlineStr"><is><t>Total</t></is></c><c r="C7"><f>SUM(C2:C6)</f><v>35</v></c></row></sheetData>',
    ),
)
await writeFile(
  fileURLToPath(new URL('suppliers-formulas.xlsx', import.meta.url)),
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
)
