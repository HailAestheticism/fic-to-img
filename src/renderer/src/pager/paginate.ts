import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { DocLayout, Typography } from '@shared/types'
import { chaptersOf } from '../editor/chapters'
import { applyTypoVars, mergedTypography } from '../presets/preset-service'

export interface PageGeometry {
  widthPx: number
  heightPx: number
  marginTopPx: number
  marginBottomPx: number
  marginLeftPx: number
  marginRightPx: number
  contentWidthPx: number
  contentHeightPx: number
}

export type PageItem =
  | {
      node: PMNode
      /** 该块在主文档中的顶层起始位置（混合界面文本层就地编辑映射用） */
      nodePos: number
      mode: 'whole'
    }
  | { node: PMNode; nodePos: number; mode: 'lines'; lineFrom: number; lineTo: number; charStarts: number[] }
  | { node: PMNode; nodePos: number; mode: 'children'; childFrom: number; childTo: number }

export interface PagePlan {
  chapterId: string
  chapterTitle: string
  isChapterStart: boolean
  /** 章内页序（0 起），自由层「当前页」作用域绑定用 */
  pageIndexInChapter: number
  items: PageItem[]
  /** 内容超出页面容量（整块保留） */
  overflow: boolean
  /** 长图画布：该页沿无限轴的实际长度 px（含页边距） */
  longPx?: number
  /** 本页正文沿推进轴实际占用的长度 px（不含页边距）：体积预测按内容密度而非整页面积折算 */
  contentPx: number
}

export function mmToPx(mm: number): number {
  return (mm * 96) / 25.4
}

/** 某章最终生效的排版令牌：章级覆盖合并到文档级之上 */
export function typographyForChapter(layout: DocLayout, chapterId: string): Typography {
  return mergedTypography(
    layout.typography,
    layout.chapters[chapterId]?.styleOverrides?.typography as Typography | undefined
  )
}

export function isInfinite(layout: DocLayout): boolean {
  return layout.pageSetup.infiniteHeight === true
}

/** 横向画布：渲染时宽高互换 */
export function isLandscape(layout: DocLayout): boolean {
  return layout.pageSetup.landscape === true
}

/** 长图未编辑文本时的最短长度：上下页边距 + 一行正文高 */
export function minLongPx(layout: DocLayout): number {
  const ps = layout.pageSetup
  const t = layout.typography
  const line = (t.bodySize || 16) * (Number(t.bodyLineHeight) || 1.9)
  return Math.round(mmToPx(ps.marginTopMm + ps.marginBottomMm) + line)
}

export function computeGeometry(layout: DocLayout, longPx?: number): PageGeometry {
  const ps = layout.pageSetup
  const inf = isInfinite(layout)
  const land = isLandscape(layout)
  let widthPx: number
  let heightPx: number
  if (!inf) {
    widthPx = mmToPx(land ? ps.heightMm : ps.widthMm)
    heightPx = mmToPx(land ? ps.widthMm : ps.heightMm)
  } else if (land) {
    widthPx = longPx ?? minLongPx(layout)
    heightPx = mmToPx(ps.widthMm)
  } else {
    widthPx = mmToPx(ps.widthMm)
    heightPx = longPx ?? minLongPx(layout)
  }
  const marginLeftPx = mmToPx(ps.marginLeftMm)
  const marginRightPx = mmToPx(ps.marginRightMm)
  const marginTopPx = mmToPx(ps.marginTopMm)
  const marginBottomPx = mmToPx(ps.marginBottomMm)
  return {
    widthPx,
    heightPx,
    marginTopPx,
    marginBottomPx,
    marginLeftPx,
    marginRightPx,
    contentWidthPx: widthPx - marginLeftPx - marginRightPx,
    contentHeightPx: heightPx - marginTopPx - marginBottomPx
  }
}

/** 某页最终几何：长图按该页实测长度 */
export function geometryForPlan(layout: DocLayout, plan: PagePlan | undefined): PageGeometry {
  return computeGeometry(layout, plan?.longPx)
}

/** 画布横向即全局竖排：正文整段竖向排列（图片/表格除外），见 .vert-flow */
export function isVerticalFlow(layout: DocLayout): boolean {
  return isLandscape(layout)
}

interface LineData {
  count: number
  /** 每行起始字符偏移 */
  starts: number[]
  /** 每行起点沿推进轴距元素起点的 px（横排=顶 / 竖排=右缘） */
  tops: number[]
}

interface BlockEntry {
  node: PMNode
  /** 顶层块在主文档中的起始位置 */
  pos: number
  el: HTMLElement
  /** 沿分页推进轴的起点：横排=距宿主顶（物理 top）；竖排=距宿主右缘（右起列序） */
  top: number
  /** 沿推进轴的展开长度：横排=height；竖排=width */
  height: number
  /** ul/ol/blockquote 的子元素划分 */
  children?: HTMLElement[]
}

function collectTextNodes(el: HTMLElement): Text[] {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  return nodes
}

/**
 * 测量段落的行盒：每行起始字符偏移与沿推进轴的位置（用于按行拆分与提取）。
 * vertical=true 时行盒自右向左排（竖排列），位置按「距元素右缘」计。
 */
function measureLines(el: HTMLElement, vertical: boolean): LineData | null {
  const textNodes = collectTextNodes(el)
  const total = textNodes.reduce((s, t) => s + t.data.length, 0)
  if (total === 0 || !textNodes.length) return null

  const locate = (offset: number): { node: Text; local: number } => {
    let acc = 0
    for (const t of textNodes) {
      if (offset <= acc + t.data.length) return { node: t, local: offset - acc }
      acc += t.data.length
    }
    const last = textNodes[textNodes.length - 1]
    return { node: last, local: last.data.length }
  }

  const elRect = el.getBoundingClientRect()
  const range = document.createRange()

  const lineCount = (x: number): number => {
    if (x <= 0) return 0
    const a = locate(0)
    const b = locate(x)
    range.setStart(a.node, a.local)
    range.setEnd(b.node, b.local)
    const rects = range.getClientRects()
    let lines = 0
    let lastEdge = Number.NaN
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i]
      if (r.width === 0 && r.height === 0) continue
      const edge = vertical ? r.left : r.top
      const isNew = Number.isNaN(lastEdge) || (vertical ? lastEdge - edge : edge - lastEdge) > 2
      if (isNew) {
        lines++
        lastEdge = edge
      }
    }
    return lines
  }

  const totalLines = lineCount(total)
  if (totalLines <= 1) return null

  /** 逻辑偏移 offset 处的字符沿推进轴距元素起点（横排=顶 / 竖排=右缘）的距离 */
  const axisOffset = (offset: number): number => {
    const p = locate(offset)
    range.setStart(p.node, p.local)
    range.setEnd(p.node, p.local)
    const r = range.getBoundingClientRect()
    return vertical ? elRect.right - r.right : r.top - elRect.top
  }

  const starts = [0]
  const tops = [0]
  for (let i = 1; i < totalLines; i++) {
    let lo = 0
    let hi = total
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (lineCount(mid) >= i + 1) hi = mid
      else lo = mid + 1
    }
    starts.push(lo)
    tops.push(axisOffset(lo))
  }
  return { count: totalLines, starts, tops }
}

/** 提取元素内 [charFrom, charTo) 的行内内容（保留行内标记结构） */
export function extractCharRange(el: HTMLElement, charFrom: number, charTo: number): DocumentFragment {
  const textNodes = collectTextNodes(el)
  const locate = (offset: number): { node: Text; local: number } => {
    let acc = 0
    for (const t of textNodes) {
      if (offset <= acc + t.data.length) return { node: t, local: offset - acc }
      acc += t.data.length
    }
    const last = textNodes[textNodes.length - 1]
    return { node: last, local: last.data.length }
  }
  const range = document.createRange()
  const a = locate(charFrom)
  const b = locate(charTo)
  range.setStart(a.node, a.local)
  range.setEnd(b.node, b.local)
  return range.cloneContents()
}

const CHILD_SPLITTABLE = new Set(['bulletList', 'orderedList', 'blockquote'])

function isParagraphSplittable(node: PMNode): boolean {
  return node.type.name === 'paragraph' && (node.textContent.trim().length > 0 || !!node.firstChild)
}

/**
 * 对整个文档分页：按章节分组、章另起页、贪心装页，
 * 段落超页按行拆分，列表/引用按子项拆分，表格/图片等整块保留。
 */
export function paginateDoc(
  doc: PMNode,
  schema: Schema,
  layout: DocLayout,
  docTitle: string
): PagePlan[] {
  const geo = computeGeometry(layout)
  const serializer = DOMSerializer.fromSchema(schema)
  const inf = isInfinite(layout)
  const vertical = isVerticalFlow(layout)

  const host = document.createElement('div')
  host.className = 'tiptap-prose paged-flow pagi-measure'
  if (vertical) {
    // 竖排：列高固定为版心高（短边），正文自右向左生长，长度由 max-content 实测
    host.classList.add('vert-flow')
    host.style.width = 'max-content'
    host.style.height = `${geo.contentHeightPx}px`
  } else {
    host.style.width = `${geo.contentWidthPx}px`
    if (inf) host.style.height = 'auto'
  }
  document.body.appendChild(host)

  try {
    const chapters = chaptersOf(doc, layout.splitRules, docTitle)
    const plans: PagePlan[] = []

    for (let ci = 0; ci < chapters.length; ci++) {
      const start = chapters[ci].pos
      const end = ci + 1 < chapters.length ? chapters[ci + 1].pos : doc.content.size
      const nodes: { node: PMNode; pos: number }[] = []
      doc.forEach((child, offset) => {
        if (offset >= start && offset < end && child.type.name !== 'chapterBreak') {
          nodes.push({ node: child, pos: offset })
        }
      })
      if (!nodes.length) continue
      applyTypoVars(host.style, typographyForChapter(layout, chapters[ci].chapterId))
      const before = plans.length
      paginateChapter(nodes, geo, serializer, host, chapters[ci], plans, inf, vertical)
      for (let i = before; i < plans.length; i++) plans[i].pageIndexInChapter = i - before
    }
    return plans
  } finally {
    host.remove()
  }
}

function paginateChapter(
  nodes: { node: PMNode; pos: number }[],
  geo: PageGeometry,
  serializer: DOMSerializer,
  host: HTMLElement,
  chapter: { chapterId: string; title: string },
  out: PagePlan[],
  long: boolean,
  vertical: boolean
): void {
  host.innerHTML = ''
  const entries: BlockEntry[] = []
  for (const { node, pos } of nodes) {
    const el = serializer.serializeNode(node) as HTMLElement
    const entry: BlockEntry = { node, pos, el, top: 0, height: 0 }
    if (CHILD_SPLITTABLE.has(node.type.name) && el.children.length > 1) {
      entry.children = Array.from(el.children) as HTMLElement[]
    }
    host.appendChild(el)
    entries.push(entry)
  }
  const hb = host.getBoundingClientRect()
  for (const e of entries) {
    const r = e.el.getBoundingClientRect()
    if (vertical) {
      e.top = hb.right - r.right
      e.height = r.width
    } else {
      e.top = r.top - hb.top
      e.height = r.height
    }
  }

  const plan = (items: PageItem[], overflow: boolean, contentPx = 0): PagePlan => ({
    chapterId: chapter.chapterId,
    chapterTitle: chapter.title,
    isChapterStart: true,
    pageIndexInChapter: 0,
    items,
    overflow,
    contentPx
  })

  // 长图：整章一页，长度取实测内容 + 页边距，不足最短长度按最短长度
  if (long) {
    const pad = vertical
      ? geo.marginLeftPx + geo.marginRightPx
      : geo.marginTopPx + geo.marginBottomPx
    const extent = (vertical ? host.offsetWidth : host.offsetHeight) + pad
    // geo 的长边在 computeGeometry 中已按最短长度兜底
    const min = vertical ? geo.widthPx : geo.heightPx
    const longPx = Math.max(min, Math.round(extent))
    out.push(
      Object.assign(
        plan(
          entries.map((e) => ({ node: e.node, nodePos: e.pos, mode: 'whole' as const })),
          false,
          Math.round(extent - pad)
        ),
        {
          longPx
        }
      )
    )
    return
  }

  // 装页沿推进轴进行：横排=物理 top（容量=版心高）；竖排=距右缘（容量=版心宽）
  const capacity = vertical ? geo.contentWidthPx : geo.contentHeightPx
  const MIN_LINES = 2
  let items: PageItem[] = []
  let pageTop = 0
  let overflow = false
  let firstPageOfChapter = true
  /** 本页已放内容沿推进轴的终点（绝对值），每次 flush 归零 */
  let contentEnd = 0

  const note = (end: number): void => {
    contentEnd = Math.max(contentEnd, end)
  }

  const flush = (): void => {
    if (!items.length) return
    out.push(
      Object.assign(plan(items, overflow, Math.max(0, Math.round(contentEnd - pageTop))), {
        isChapterStart: firstPageOfChapter
      })
    )
    items = []
    overflow = false
    contentEnd = 0
    firstPageOfChapter = false
  }

  /** 子项沿推进轴距块起点的距离 */
  const childAxis = (blockEl: HTMLElement, c: HTMLElement): number => {
    const br = blockEl.getBoundingClientRect()
    const r = c.getBoundingClientRect()
    return vertical ? br.right - r.right : r.top - br.top
  }

  for (const b of entries) {
    const top = b.top
    const relTop = top - pageTop

    if (relTop + b.height <= capacity + 0.5) {
      items.push({ node: b.node, nodePos: b.pos, mode: 'whole' })
      note(top + b.height)
      continue
    }

    // 段落按行（竖排时按列）拆分
    if (!b.children && isParagraphSplittable(b.node) && b.height <= capacity) {
      const ld = measureLines(b.el, vertical)
      if (ld) {
        let s = 0
        for (let k = MIN_LINES; k <= ld.count - MIN_LINES; k++) {
          if (top - pageTop + ld.tops[k] <= capacity + 0.5) s = k
          else break
        }
        if (s >= MIN_LINES && ld.count - s >= MIN_LINES) {
          items.push({
            node: b.node,
            nodePos: b.pos,
            mode: 'lines',
            lineFrom: 0,
            lineTo: s,
            charStarts: ld.starts
          })
          note(top + ld.tops[s])
          flush()
          pageTop = top + ld.tops[s]
          items.push({
            node: b.node,
            nodePos: b.pos,
            mode: 'lines',
            lineFrom: s,
            lineTo: ld.count,
            charStarts: ld.starts
          })
          note(b.top + b.height)
          continue
        }
      }
    }

    // 列表/引用按子项拆分
    if (b.children && b.height <= capacity) {
      const childTops = b.children.map((c) => childAxis(b.el, c))
      let c = 0
      for (let k = 1; k < b.children.length; k++) {
        if (top - pageTop + childTops[k] <= capacity + 0.5) c = k
        else break
      }
      if (c >= 1 && b.children.length - c >= 1) {
        items.push({ node: b.node, nodePos: b.pos, mode: 'children', childFrom: 0, childTo: c })
        note(top + childTops[c])
        flush()
        pageTop = top + childTops[c]
        items.push({
          node: b.node,
          nodePos: b.pos,
          mode: 'children',
          childFrom: c,
          childTo: b.children.length
        })
        note(b.top + b.height)
        continue
      }
    }

    // 整块保留，换页
    flush()
    pageTop = top
    items.push({ node: b.node, nodePos: b.pos, mode: 'whole' })
    note(top + b.height)
    if (b.height > capacity + 0.5) overflow = true
  }
  flush()
}
