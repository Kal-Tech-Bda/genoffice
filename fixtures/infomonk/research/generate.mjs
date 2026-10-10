import JSZip from 'jszip'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const folder = resolve('fixtures/infomonk/research')
await mkdir(folder, { recursive: true })
const valid = [
  'Supplier Quote',
  'Quote ID: Q-100',
  'Supplier: Northwind Demo',
  'Date: 2026-09-01',
  'Currency: CAD',
  'Total: 125.50',
  'Country code: CAN',
  'Item 1 | Paper | 5 | 20.00',
  'Item 2 | Delivery | 1 | 25.50',
]
const missing = [
  'Supplier Quote',
  'Quote ID: Q-200',
  'Supplier: South Demo',
  'Date: 2026-02-31',
  'Currency: USD',
  'Country code: USA',
]
const conflict = [...valid.slice(0, 7), 'Total: 130.00']
for (const [name, lines] of [
  ['valid.txt', valid],
  ['missing.md', missing],
  ['conflict.txt', conflict],
])
  await writeFile(join(folder, name), lines.join('\n') + '\n')
await writeFile(
  join(folder, 'unsupported.txt'),
  'A synthetic unstructured note. No supported quote labels.\n',
)
await writeFile(join(folder, 'broken.pdf'), 'Deliberately invalid PDF fixture')
const zip = new JSZip()
zip.file(
  '[Content_Types].xml',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
)
zip.file(
  '_rels/.rels',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
)
zip.file(
  'word/document.xml',
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${valid.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')}<w:sectPr/></w:body></w:document>`,
)
zip.forEach((_name, entry) => {
  entry.date = new Date('2026-09-01T00:00:00Z')
})
await writeFile(join(folder, 'valid.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
const paragraph = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
const table = (rows) =>
  `<w:tbl><w:tblPr/><w:tblGrid>${rows[0].map(() => '<w:gridCol w:w="1800"/>').join('')}</w:tblGrid>${rows.map((row) => `<w:tr>${row.map((value) => `<w:tc><w:tcPr/>${paragraph(value)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
zip.file(
  'word/document.xml',
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph('Supplier Quote')}${table(valid.slice(1, 7).map((line) => line.split(': ')))}${table(
    [
      ['Item', 'Description', 'Quantity', 'Unit price'],
      ['1', 'Paper', '5', '20.00'],
      ['2', 'Delivery', '1', '25.50'],
    ],
  )}<w:sectPr/></w:body></w:document>`,
)
zip.forEach((_name, entry) => {
  entry.date = new Date('2026-09-01T00:00:00Z')
})
await writeFile(join(folder, 'table.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
// Reproducible text-layer PDF, with exact known content order and no external fonts.
const text = valid
  .map((line, i) => `BT /F1 12 Tf 50 ${760 - i * 24} Td (${line.replace(/[()\\]/g, '\\$&')}) Tj ET`)
  .join('\n')
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
]
let pdf = '%PDF-1.4\n'
const offsets = [0]
objects.forEach((object, i) => {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
})
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((o) => String(o).padStart(10, '0') + ' 00000 n \n')
  .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
await writeFile(join(folder, 'valid.pdf'), pdf)
await writeFile(
  join(folder, 'expected.json'),
  JSON.stringify(
    {
      synthetic: true,
      quoteId: 'Q-100',
      supplier: 'Northwind Demo',
      date: '2026-09-01',
      currency: 'CAD',
      total: 125.5,
      countryCode: 'CAN',
      lineItems: 2,
      locators: {
        textTotal: 'Text line 6',
        docxTotal: 'DOCX body element 6',
        pdfTotal: 'PDF page 1, line 6',
      },
      missing: { quoteId: 'Q-200', date: null, total: null },
      conflict: { quoteId: 'Q-100', total: null },
    },
    null,
    2,
  ) + '\n',
)
