import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
const stream = '0.7 0.7 0.7 rg 40 40 520 700 re f\n'
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
]
let pdf = '%PDF-1.4\n'
const offsets = [0]
for (const [i, object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf))
  pdf += `${i + 1} 0 obj\n${object}\nendobj\n`
}
const xref = Buffer.byteLength(pdf)
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
pdf += offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('')
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
await writeFile(join(import.meta.dirname, 'no-text-layer.pdf'), pdf)
