import { parse, type DefaultTreeAdapterTypes as T } from 'parse5'

export type HtmlNode = T.Node
export function publicHtml(bytes: Buffer): HtmlNode[] {
  if (bytes.length > 2 * 1024 * 1024) throw new Error('HTML exceeds the 2 MiB source limit.')
  const result: HtmlNode[] = [],
    pending: { node: HtmlNode; depth: number }[] = [
      { node: parse(bytes.toString('utf8')), depth: 0 },
    ]
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (depth > 200 || result.length >= 50_000)
      throw new Error('HTML structure exceeds supported bounds.')
    result.push(node)
    if ('childNodes' in node)
      for (const child of [...node.childNodes].reverse())
        pending.push({ node: child, depth: depth + 1 })
  }
  return result
}
export function htmlTag(node: HtmlNode): string {
  return 'tagName' in node ? node.tagName : ''
}
export function htmlAttr(node: HtmlNode, name: string): string {
  return 'attrs' in node ? (node.attrs.find((a) => a.name === name)?.value ?? '') : ''
}
export function htmlText(node: HtmlNode): string {
  if ('value' in node) return node.value
  if (['script', 'style', 'template'].includes(htmlTag(node))) return ''
  return ('childNodes' in node ? node.childNodes.map(htmlText).join(' ') : '')
    .replace(/\s+/g, ' ')
    .trim()
}
export function htmlPath(node: HtmlNode): string {
  const indices: number[] = []
  let current = node
  while ('parentNode' in current && current.parentNode) {
    const parent = current.parentNode
    indices.unshift(parent.childNodes.indexOf(current))
    current = parent
  }
  return `HTML /${indices.join('/')}`
}
