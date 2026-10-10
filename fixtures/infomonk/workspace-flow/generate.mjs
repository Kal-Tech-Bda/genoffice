import JSZip from 'jszip'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
const folder = resolve('fixtures/infomonk/workspace-flow')
await mkdir(folder, { recursive: true })
function quote(id, supplier, total, unitPrice) {
  return [
    'Supplier Quote',
    `Quote ID: ${id}`,
    `Supplier: ${supplier}`,
    'Date: 2026-10-01',
    'Currency: CAD',
    `Total: ${total ?? ''}`,
    'Country code: CAN',
    `Item 1 | Paper packs | 5 | ${unitPrice}`,
  ]
}
const northwind = quote('Q-N001', 'Northwind Demo', '100.00', '20.00'),
  cedar = quote('Q-C001', 'Cedar Demo', '90.00', '18.00'),
  maple = quote('Q-M001', 'Maple Demo', null, '22.00')
for (const [name, lines] of [
  ['northwind.txt', northwind],
  ['northwind-v2.txt', quote('Q-N001', 'Northwind Demo', '120.00', '24.00')],
  ['maple-v2.txt', quote('Q-M001', 'Maple Demo', '115.00', '23.00')],
])
  await writeFile(join(folder, name), lines.join('\n') + '\n')
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
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${cedar.map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`).join('')}<w:sectPr/></w:body></w:document>`,
)
zip.forEach((_name, entry) => {
  entry.date = new Date('2026-10-01T00:00:00Z')
})
await writeFile(join(folder, 'cedar.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
const text = maple
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
  .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
  .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
await writeFile(join(folder, 'maple.pdf'), pdf)
