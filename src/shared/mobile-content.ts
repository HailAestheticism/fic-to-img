import type { PMNode } from './types'

/**
 * 手机端「大标题 + 纯文本」投影（取代旧 markdown 语法投影）：
 * - 手机端没有任何格式概念，与 markdown 重合的符号（#、*、- 等）一律是普通字符，不做任何解析；
 * - 唯一特殊格式是大标题（docTitle/H0）：只区分「标题 + 正文」，不携带 PC 端的字号字体；
 * - 列表投影为带 • / N. 前缀的普通行，图片/表格等无法表示的块投影为占位行；
 * - 回写（手机 → PC）按纯文本整篇重建，PC 端排版（标题层级、加粗、图片、表格等）不保留。
 */

export interface MobileDocProjection {
  title: string
  body: string
  /** PC 端文档含投影表达不了的排版（行内样式/标题层级/图片/表格等），移动端据此提示「回传不还原」 */
  rich: boolean
}

/** 行内样式标记：出现任意一种即视为「排版无法在手机端表达」 */
const RICH_MARKS = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'textStyle'])
/** 段落属性里代表排版的键：有值即 rich */
const RICH_PARA_ATTRS = ['textAlign', 'indentLeft', 'indentRight', 'textIndent', 'spaceBefore', 'spaceAfter']

interface Walk {
  lines: string[]
  rich: boolean
  title: string | null
}

function inlineText(node: PMNode, w: Walk): string {
  if (node.type === 'text') {
    if ((node.marks ?? []).some((m) => RICH_MARKS.has(m.type))) w.rich = true
    return node.text ?? ''
  }
  if (node.type === 'hardBreak') return ' '
  return (node.content ?? []).map((c) => inlineText(c, w)).join('')
}

function childrenText(node: PMNode, w: Walk): string {
  return (node.content ?? []).map((c) => inlineText(c, w)).join('')
}

function listText(item: PMNode, w: Walk): string {
  return (item.content ?? []).map((c) => childrenText(c, w)).join(' ')
}

function paraAttrsRich(attrs: Record<string, unknown> | undefined): boolean {
  if (!attrs) return false
  return RICH_PARA_ATTRS.some((k) => {
    const v = attrs[k]
    return v !== null && v !== undefined && v !== ''
  })
}

function blockToLines(block: PMNode, w: Walk): void {
  const attrs = (block.attrs ?? {}) as Record<string, unknown>
  switch (block.type) {
    case 'docTitle':
      // docTitle 只允许出现在首块；防御性地把后续同名块按普通行投影
      if (w.title === null) w.title = childrenText(block, w)
      else w.lines.push(childrenText(block, w))
      break
    case 'paragraph':
      if (paraAttrsRich(attrs)) w.rich = true
      w.lines.push(childrenText(block, w))
      break
    case 'heading':
      w.rich = true
      w.lines.push(childrenText(block, w))
      break
    case 'bulletList':
      w.rich = true
      for (const li of block.content ?? []) w.lines.push(`• ${listText(li, w)}`)
      break
    case 'orderedList':
      w.rich = true
      ;(block.content ?? []).forEach((li, i) => w.lines.push(`${i + 1}. ${listText(li, w)}`))
      break
    case 'blockquote':
      w.rich = true
      for (const c of block.content ?? []) blockToLines(c, w)
      break
    case 'codeBlock':
      w.rich = true
      w.lines.push(...(block.content ?? []).map((c) => c.text ?? '').join('\n').split('\n'))
      break
    case 'horizontalRule':
      w.rich = true
      w.lines.push('———')
      break
    case 'chapterBreak':
      w.rich = true
      w.lines.push(`◆ ${String(attrs.title ?? '未命名章节')}`)
      break
    case 'image':
      w.rich = true
      w.lines.push('［图片］')
      break
    case 'table':
      w.rich = true
      w.lines.push('［表格］')
      break
    default:
      // 未知块无法表达，静默丢弃（schema 覆盖了以上全部类型）
      break
  }
}

/** PC 文档 → 手机端「大标题 + 正文」投影 */
export function docToMobile(content: PMNode): MobileDocProjection {
  const w: Walk = { lines: [], rich: false, title: null }
  for (const block of content.content ?? []) blockToLines(block, w)
  while (w.lines.length && !w.lines[w.lines.length - 1].trim()) w.lines.pop()
  return {
    title: w.title?.trim() ?? '',
    body: w.lines.join('\n'),
    rich: w.rich
  }
}

/**
 * 手机端文档 → PC 文档：title 成为首块 docTitle（空标题不放），正文逐行成段。
 * 整篇重建，不复用原节点——手机端没有格式，任何样式都不可能被保留。
 */
export function mobileToDoc(proj: { title: string; body: string }): PMNode {
  const blocks: PMNode[] = []
  const title = proj.title.trim()
  if (title) blocks.push({ type: 'docTitle', content: [{ type: 'text', text: title }] })
  const lines = proj.body.replace(/\r\n/g, '\n').replace(/[\s\u3000]+$/, '').split('\n')
  for (const line of lines) {
    blocks.push(line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })
  }
  if (!blocks.length) blocks.push({ type: 'paragraph' })
  return { type: 'doc', content: blocks }
}
