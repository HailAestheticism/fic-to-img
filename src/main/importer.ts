import type { PMNode } from '../shared/types'

/** 递归提取 ProseMirror 文档纯文本（用于全文搜索） */
export function pmToText(node: PMNode): string {
  const out: string[] = []
  const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'tableRow', 'listItem'])
  const walk = (n: PMNode): void => {
    if (n.type === 'text' && n.text) {
      out.push(n.text)
      return
    }
    if (Array.isArray(n.content)) n.content.forEach(walk)
    if (BLOCKS.has(n.type)) out.push('\n')
  }
  walk(node)
  return out.join('')
}

function inlineMarks(s: string): PMNode[] {
  const nodes: PMNode[] = []
  // 反引号不作 `code` 标记：编辑器 Schema 里没有行内代码（StarterKit code:false），写了会让文档读不出来
  const re = /(\*\*|__)(.+?)\1|(\*|(?<![\w_])_(?!\s))(.+?)\3|~~(.+?)~~|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) nodes.push({ type: 'text', text: s.slice(last, m.index) })
    if (m[2] !== undefined) nodes.push({ type: 'text', text: m[2], marks: [{ type: 'bold' }] })
    else if (m[4] !== undefined) nodes.push({ type: 'text', text: m[4], marks: [{ type: 'italic' }] })
    else if (m[5] !== undefined) nodes.push({ type: 'text', text: m[5], marks: [{ type: 'strike' }] })
    else if (m[6] !== undefined) nodes.push({ type: 'text', text: m[6] })
    last = re.lastIndex
  }
  if (last < s.length) nodes.push({ type: 'text', text: s.slice(last) })
  return nodes.length ? nodes : s ? [{ type: 'text', text: s }] : []
}

/** 轻量 Markdown → ProseMirror JSON（标题/段落/引用/列表/分割线/行内样式；``` 围栏按普通段落收下） */
export function markdownToPM(src: string): PMNode {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const blocks: PMNode[] = []
  const para: string[] = []
  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ type: 'paragraph', content: inlineMarks(para.join('\n')) })
      para.length = 0
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    const fence = line.match(/^```\w*\s*$/)
    if (fence) {
      flushPara()
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        if (lines[i].trim() !== '') blocks.push({ type: 'paragraph', content: [{ type: 'text', text: lines[i] }] })
        i++
      }
      i++
      continue
    }

    const h = line.match(/^(#{1,6})\s+(.*)/)
    if (h) {
      flushPara()
      blocks.push({
        type: 'heading',
        attrs: { level: Math.min(3, h[1].length) },
        content: inlineMarks(h[2])
      })
      i++
      continue
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara()
      blocks.push({ type: 'horizontalRule' })
      i++
      continue
    }

    if (/^>\s?/.test(line)) {
      flushPara()
      const quoted: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({
        type: 'blockquote',
        content: quoted.map((t) => ({ type: 'paragraph', content: inlineMarks(t) }))
      })
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
        i++
      }
      blocks.push({
        type: 'bulletList',
        content: items.map((t) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: inlineMarks(t) }]
        }))
      })
      continue
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
        i++
      }
      blocks.push({
        type: 'orderedList',
        content: items.map((t) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: inlineMarks(t) }]
        }))
      })
      continue
    }

    if (!line.trim()) {
      flushPara()
      i++
      continue
    }

    para.push(line)
    i++
  }
  flushPara()
  if (!blocks.length) blocks.push({ type: 'paragraph' })
  return { type: 'doc', content: blocks }
}

/** 纯文本 → 按空行分段 */
export function plainTextToPM(src: string): PMNode {
  const paras = src
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
  const content: PMNode[] = paras.length
    ? paras.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }))
    : [{ type: 'paragraph' }]
  return { type: 'doc', content }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** 粗略 HTML → 纯文本分段（阶段 1 的降级导入，后续再做结构化 HTML 导入） */
export function htmlToPM(src: string): PMNode {
  let s = src.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/(p|h[1-6]|div|li|blockquote|tr)>/gi, '\n\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  return plainTextToPM(s)
}
