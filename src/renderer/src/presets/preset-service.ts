import type { PMNode, Typography } from '@shared/types'
import { h0ScaleOf } from '@shared/layout'

/** 本机常用字体（排版面板与工具栏共用） */
export const FONT_OPTIONS = [
  'Microsoft YaHei',
  'SimSun',
  'SimHei',
  'KaiTi',
  'FangSong',
  'DengXian',
  'STKaiti',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Consolas'
]

export const FONT_LABELS: Record<string, string> = {
  'Microsoft YaHei': '微软雅黑',
  SimSun: '宋体',
  SimHei: '黑体',
  KaiTi: '楷体',
  FangSong: '仿宋',
  DengXian: '等线',
  STKaiti: '华文楷体',
  Arial: 'Arial',
  Georgia: 'Georgia',
  'Times New Roman': 'Times New Roman',
  Consolas: 'Consolas'
}

/** 把排版令牌写成 CSS 自定义属性（内联 style 字符串） */
export function typoVarsStyle(t: Typography): string {
  const vars = [
    `--tf-body:'${t.bodyFont}'`,
    `--ts-body:${t.bodySize}px`,
    `--tl-body:${t.bodyLineHeight}`,
    `--tc-body:${t.bodyColor}`,
    `--tf-head:'${t.headingFont}'`,
    `--tc-head:${t.headingColor}`,
    `--sc-h0:${h0ScaleOf(t)}`,
    `--sc-h1:${t.h1Scale}`,
    `--sc-h2:${t.h2Scale}`,
    `--sc-h3:${t.h3Scale}`,
    `--tc-quote:${t.quoteColor}`
  ]
  if (t.h4Scale !== undefined) vars.push(`--sc-h4:${t.h4Scale}`)
  if (t.h5Scale !== undefined) vars.push(`--sc-h5:${t.h5Scale}`)
  if (t.h6Scale !== undefined) vars.push(`--sc-h6:${t.h6Scale}`)
  if (t.spaceBeforePt !== undefined) vars.push(`--tb-before:${t.spaceBeforePt}pt`)
  if (t.spaceAfterPt !== undefined) vars.push(`--tb-after:${t.spaceAfterPt}pt`)
  if (t.defaultTextIndent) vars.push(`--ti-first:${t.defaultTextIndent}`)
  return vars.join('; ')
}

/** 逐条 setProperty（用于根节点等需要单独设置的场景）；先清后设，避免移除项残留 */
export function applyTypoVars(style: CSSStyleDeclaration, t: Typography): void {
  for (const name of [
    '--tf-body', '--ts-body', '--tl-body', '--tc-body',
    '--tf-head', '--tc-head', '--sc-h0', '--sc-h1', '--sc-h2', '--sc-h3',
    '--tc-quote', '--sc-h4', '--sc-h5', '--sc-h6',
    '--tb-before', '--tb-after', '--ti-first'
  ]) {
    style.removeProperty(name)
  }
  for (const pair of typoVarsStyle(t).split(';')) {
    const idx = pair.indexOf(':')
    if (idx <= 0) continue
    style.setProperty(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
  }
}

/** 章级覆盖与文档级排版合并 */
export function mergedTypography(
  base: Typography | undefined,
  chapterOverride: Typography | undefined
): Typography {
  return chapterOverride ? { ...(base as Typography), ...chapterOverride } : base as Typography
}

function cleanAttrs(attrs: Record<string, any> | undefined): Record<string, any> | undefined {
  if (!attrs) return attrs
  const next = { ...attrs }
  // chapterId 是章节绑定，不是手动排版，必须保留
  delete next.lineHeight
  delete next.textIndent
  delete next.textAlign
  delete next.indentLeft
  delete next.indentRight
  delete next.spaceBefore
  delete next.spaceAfter
  return next
}

function stripNode(node: PMNode): PMNode {
  const next: PMNode = { type: node.type }
  const attrs = cleanAttrs(node.attrs)
  if (attrs && Object.keys(attrs).length) next.attrs = attrs
  if (node.marks) {
    // 清除手动设置的字体/字号/颜色（textStyle 标记），保留加粗斜体等语义标记
    const marks = node.marks.filter((m) => m.type !== 'textStyle')
    if (marks.length) next.marks = marks.map((m) => ({ ...m }))
  }
  if (node.text !== undefined) next.text = node.text
  if (node.content) next.content = node.content.map(stripNode)
  return next
}

/**
 * 清除手动排版覆盖（强制覆盖预设时使用）。
 * scope.chapterId 省略时作用于全文；否则只作用于该章节的顶层块。
 */
export function stripManualFormatting(
  json: PMNode,
  opts: { chapterId?: string }
): PMNode {
  if (!json.content) return json
  const out: PMNode[] = []
  let current: string | null = '__pre'
  let matched = !opts.chapterId

  for (const block of json.content) {
    if (block.type === 'chapterBreak') {
      current = String(block.attrs?.chapterId ?? '')
      if (opts.chapterId && current === opts.chapterId) matched = true
      else if (opts.chapterId && matched) matched = false
      out.push(matched ? stripBlockShallow(block) : block)
      continue
    }
    if (block.type === 'heading' && block.attrs?.chapterId) {
      current = String(block.attrs.chapterId)
      if (opts.chapterId) matched = current === opts.chapterId
    }
    out.push(matched ? stripBlockShallow(block) : block)
  }

  // 目标章节不存在时不动内容
  if (opts.chapterId && !json.content.some((b) => blockChapterId(b) === opts.chapterId)) {
    return json
  }
  return { ...json, content: out }
}

function blockChapterId(block: PMNode): string | null {
  if (block.type === 'chapterBreak') return String(block.attrs?.chapterId ?? '') || null
  if (block.type === 'heading' && block.attrs?.chapterId) return String(block.attrs.chapterId)
  return null
}

function stripBlockShallow(block: PMNode): PMNode {
  const attrs = cleanAttrs(block.attrs)
  const next: PMNode = { ...block }
  if (attrs && Object.keys(attrs).length) next.attrs = attrs
  else delete next.attrs
  if (next.content) next.content = next.content.map(stripNode)
  return next
}
