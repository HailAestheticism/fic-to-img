import type { DOMSerializer } from '@tiptap/pm/model'
import type { AlignKind, BackgroundSpec, DocLayout } from '@shared/types'
import { applyTypoVars } from '../presets/preset-service'
import { applyBackgroundSpec } from './background-render'
import type { PageGeometry, PageItem, PagePlan } from './paginate'
import { extractCharRange, isVerticalFlow, typographyForChapter } from './paginate'

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag)
  if (className) e.className = className
  return e
}

function fillTemplate(
  tpl: string,
  vars: { title: string; chapter: string; page: number; total: number }
): string {
  return tpl
    .replaceAll('{title}', vars.title)
    .replaceAll('{chapter}', vars.chapter)
    .replaceAll('{page}', String(vars.page))
    .replaceAll('{total}', String(vars.total))
}

/** 把一页正文里的一项（整块或拆分片段）序列化进容器；导出合成大图也复用 */
export function renderItem(container: HTMLElement, item: PageItem, serializer: DOMSerializer): void {
  const node = serializer.serializeNode(item.node) as HTMLElement
  if (item.mode === 'whole') {
    node.setAttribute('data-pm-pos', String(item.nodePos))
    container.appendChild(node)
    return
  }
  let appended: HTMLElement
  if (item.mode === 'lines') {
    const clone = node.cloneNode(false) as HTMLElement
    const charTo =
      item.lineTo < item.charStarts.length
        ? item.charStarts[item.lineTo]
        : Number.MAX_SAFE_INTEGER
    clone.appendChild(extractCharRange(node, item.charStarts[item.lineFrom], charTo))
    appended = clone
  } else {
    const clone = node.cloneNode(false) as HTMLElement
    Array.from(node.children)
      .slice(item.childFrom, item.childTo)
      .forEach((c) => clone.appendChild(c))
    appended = clone
  }
  // 混合界面文本层：同一段被拆页时两半共享同一 data-pm-pos，点任意一半都编辑整块
  appended.setAttribute('data-pm-pos', String(item.nodePos))
  container.appendChild(appended)
}

/** 解析某页最终生效背景：页 > 章 > 全局 */
export function resolveBackground(layout: DocLayout, plan: PagePlan): BackgroundSpec | null {
  const bgs = layout.backgrounds
  const key = `${plan.chapterId}:${plan.pageIndexInChapter}`
  return bgs.page[key] ?? bgs.chapter[plan.chapterId] ?? bgs.global ?? null
}

export async function buildPageElement(opts: {
  plan: PagePlan
  pageNumber: number
  totalPages: number
  geometry: PageGeometry
  layout: DocLayout
  docTitle: string
  serializer: DOMSerializer
  /** 该页最终生效的背景（页面 > 章 > 全局，由调用方解析） */
  background: BackgroundSpec | null
}): Promise<HTMLElement> {
  const { plan, pageNumber, totalPages, geometry: geo, layout, docTitle, serializer, background } = opts
  const ps = layout.pageSetup

  const paper = el('div', 'paper')
  paper.style.width = `${geo.widthPx}px`
  paper.style.height = `${geo.heightPx}px`
  applyTypoVars(paper.style, typographyForChapter(layout, plan.chapterId))
  await applyBackgroundSpec(paper, background)

  const bgLayer = el('div', 'free-layer free-layer-bg')
  paper.appendChild(bgLayer)

  const content = el('div', 'paper-content tiptap-prose paged-flow')
  content.style.left = `${geo.marginLeftPx}px`
  content.style.top = `${geo.marginTopPx}px`
  content.style.width = `${geo.contentWidthPx}px`
  content.style.height = `${geo.contentHeightPx}px`
  if (isVerticalFlow(layout)) {
    // 画布横向=全局竖排：正文整段竖向排列，列贴版心上缘、自右向左生长
    content.classList.add('vert-flow')
  }
  for (const item of plan.items) {
    renderItem(content, item, serializer)
  }
  paper.appendChild(content)

  const vars = {
    title: docTitle,
    chapter: plan.chapterTitle,
    page: pageNumber,
    total: totalPages
  }
  const headerText = fillTemplate(ps.header.text, vars)
  if (ps.header.enabled && headerText.trim()) {
    const header = el('div', `paper-header align-${ps.header.align}`)
    header.style.top = `${geo.marginTopPx * 0.45}px`
    header.style.left = `${geo.marginLeftPx}px`
    header.style.right = `${geo.marginRightPx}px`
    header.style.fontSize = `${ps.header.fontSize}pt`
    header.textContent = headerText
    paper.appendChild(header)
  }

  const bottom = `${geo.marginBottomPx * 0.4}px`
  if (ps.footer.enabled) {
    const footerText = fillTemplate(ps.footer.text, vars)
    if (footerText.trim()) {
      const footer = el('div', `paper-footer align-${ps.footer.align}`)
      footer.style.bottom = bottom
      footer.style.left = `${geo.marginLeftPx}px`
      footer.style.right = `${geo.marginRightPx}px`
      footer.style.fontSize = `${ps.footer.fontSize}pt`
      footer.textContent = footerText
      paper.appendChild(footer)
    }
    if (ps.footer.showPageNumber) {
      const no = el('div', `paper-pageno align-${ps.footer.pageNumberAlign ?? ps.footer.align}`)
      no.style.bottom = bottom
      no.style.left = `${geo.marginLeftPx}px`
      no.style.right = `${geo.marginRightPx}px`
      no.style.fontSize = `${ps.footer.pageNumberFontSize ?? ps.footer.fontSize}pt`
      no.textContent = fillTemplate(ps.footer.pageNumberFormat || '{page} / {total}', vars)
      paper.appendChild(no)
    }
  }

  const topLayer = el('div', 'free-layer free-layer-top')
  paper.appendChild(topLayer)

  return paper
}

/** 图层容器：背景层在正文之下、顶层覆盖正文与页眉页脚 */
export function layerHost(paper: HTMLElement, layer: 'bg' | 'top'): HTMLElement | undefined {
  return paper.querySelector<HTMLElement>(`.free-layer-${layer}`) ?? undefined
}

export const ALIGN_LABELS: Record<AlignKind, string> = {
  left: '居左',
  center: '居中',
  right: '居右'
}
