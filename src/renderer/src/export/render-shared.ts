import { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { BackgroundSpec, DocBundle, DocLayout, LayoutLayer } from '@shared/types'
import { buildExtensions } from '../editor/setup'
import { chaptersOf } from '../editor/chapters'
import { geometryForPlan, isVerticalFlow, typographyForChapter } from '../pager/paginate'
import type { PageGeometry, PagePlan } from '../pager/paginate'
import { buildPageElement, layerHost, renderItem, resolveBackground } from '../pager/render-page'
import { applyBackgroundSpec } from '../pager/background-render'
import { applyTypoVars } from '../presets/preset-service'
import { renderFreeLayerInto } from '../pager/free-layer-render'
import { elementsForLayer } from '../freelay/fabric-service'

export interface ExportEditor {
  editor: Editor
  serializer: DOMSerializer
  host: HTMLDivElement
  destroy(): void
}

/** 隐藏 Tiptap 实例 + DOMSerializer（导出渲染面与缩略图画廊共用） */
export function createExportEditor(bundle: DocBundle): ExportEditor {
  const host = document.createElement('div')
  host.className = 'pagi-hidden-editor'
  document.body.appendChild(host)
  const editor = new Editor({
    extensions: buildExtensions(),
    content: bundle.content,
    editable: false,
    element: host
  })
  const serializer = DOMSerializer.fromSchema(editor.schema)
  return {
    editor,
    serializer,
    host,
    destroy() {
      editor.destroy()
      host.remove()
    }
  }
}

/** 等图片与字体就绪，再走两帧，保证截图/缩略图完整 */
export async function settle(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    imgs.map((img) => ((img as HTMLImageElement).decode?.() ?? Promise.resolve()).catch(() => undefined))
  )
  try {
    await document.fonts.ready
  } catch {
    /* 字体就绪检测失败不阻塞导出 */
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

/** 收集某章（chapterId=null 为全文）的顶层内容块，复用章节切分结果 */
export function collectNodes(editor: Editor, bundle: DocBundle, chapterId: string | null): PMNode[] {
  const doc = editor.state.doc
  const chapters = chaptersOf(doc, bundle.layout.splitRules, bundle.meta.title)
  const nodes: PMNode[] = []
  doc.forEach((child, offset) => {
    if (child.type.name === 'chapterBreak') return
    if (!chapterId) {
      nodes.push(child)
      return
    }
    let owner = chapters[0]?.chapterId ?? ''
    for (const c of chapters) {
      if (offset >= c.pos) owner = c.chapterId
    }
    if (owner === chapterId) nodes.push(child)
  })
  return nodes
}

/** 整页 DOM（含背景与两个静态图层），尺寸 = 该页几何逻辑像素 */
export async function buildFullPageEl(opts: {
  bundle: DocBundle
  plan: PagePlan
  pageNumber: number
  totalPages: number
  serializer: DOMSerializer
  multiplier: number
}): Promise<{ el: HTMLElement; geo: PageGeometry }> {
  const layout = opts.bundle.layout
  const g = geometryForPlan(layout, opts.plan)
  const el = await buildPageElement({
    plan: opts.plan,
    pageNumber: opts.pageNumber,
    totalPages: opts.totalPages,
    geometry: g,
    layout,
    docTitle: opts.bundle.meta.title,
    serializer: opts.serializer,
    background: resolveBackground(layout, opts.plan)
  })
  for (const l of ['bg', 'top'] as LayoutLayer[]) {
    const host = layerHost(el, l)
    if (host) await renderFreeLayerInto(host, elementsForLayer(layout, opts.plan, l), g, opts.multiplier)
  }
  return { el, geo: g }
}

/** 长图/合成图共用外壳：wrap 管背景与页边距，flow 管排版与竖排方向 */
async function flowShell(
  layout: DocLayout,
  geo: PageGeometry,
  typoChapterId: string | null,
  bg: BackgroundSpec | null
): Promise<{ wrap: HTMLElement; flow: HTMLElement; vert: boolean }> {
  const vert = isVerticalFlow(layout)
  const wrap = document.createElement('div')
  wrap.style.position = 'relative'
  await applyBackgroundSpec(wrap, bg)
  if (!bg) wrap.style.backgroundColor = '#ffffff'

  const flow = document.createElement('div')
  flow.className = 'tiptap-prose paged-flow'
  applyTypoVars(flow.style, typographyForChapter(layout, typoChapterId ?? ''))
  if (vert) {
    // 竖排（=画布横向）：沿水平轴生长，高度钉在版心高
    wrap.style.width = 'max-content'
    wrap.style.height = `${geo.heightPx}px`
    wrap.style.padding = `${geo.marginTopPx}px ${geo.marginRightPx}px ${geo.marginBottomPx}px ${geo.marginLeftPx}px`
    flow.classList.add('vert-flow')
    flow.style.width = 'max-content'
    flow.style.height = `${geo.contentHeightPx}px`
  } else {
    wrap.style.width = `${geo.widthPx}px`
    flow.style.width = `${geo.contentWidthPx}px`
    flow.style.padding = `${geo.marginTopPx}px ${geo.marginRightPx}px ${geo.marginBottomPx}px ${geo.marginLeftPx}px`
  }
  wrap.appendChild(flow)
  return { wrap, flow, vert }
}

/** 量整幅尺寸：脱离文档的 div scrollHeight 恒 0，必须临时挂到屏外 */
async function measureFlow(
  wrap: HTMLElement,
  geo: PageGeometry,
  vert: boolean
): Promise<{ widthCss: number; heightCss: number }> {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;left:-100000px;top:0;'
  probe.appendChild(wrap)
  document.body.appendChild(probe)
  await settle(wrap)
  const widthCss = vert ? wrap.offsetWidth : geo.widthPx
  const heightCss = vert ? geo.heightPx : wrap.scrollHeight
  probe.remove()
  return { widthCss, heightCss }
}

/** 长图连续流：整幅 DOM（chapterId=null 为全文），返回元素与逻辑尺寸。
 *  画布横向（=全局竖排）时沿水平轴生长（古籍右起），否则沿垂直轴生长。 */
export async function buildLongFlowEl(opts: {
  bundle: DocBundle
  editor: Editor
  serializer: DOMSerializer
  geo: PageGeometry
  chapterId: string | null
}): Promise<{ el: HTMLElement; widthCss: number; heightCss: number }> {
  const { bundle, editor, serializer, geo, chapterId } = opts
  const layout = bundle.layout
  const bg = chapterId
    ? (layout.backgrounds.chapter[chapterId] ?? layout.backgrounds.global)
    : layout.backgrounds.global
  const { wrap, flow, vert } = await flowShell(layout, geo, chapterId, bg)
  for (const n of collectNodes(editor, bundle, chapterId)) {
    flow.appendChild(serializer.serializeNode(n) as HTMLElement)
  }
  return { el: wrap, ...(await measureFlow(wrap, geo, vert)) }
}

/** 合成大图连续流：把所选各页正文按页序首尾相接成一条流（背景取全局，避免逐页背景互相覆盖） */
export async function buildPlansFlowEl(opts: {
  bundle: DocBundle
  serializer: DOMSerializer
  geo: PageGeometry
  plans: PagePlan[]
}): Promise<{ el: HTMLElement; widthCss: number; heightCss: number }> {
  const { bundle, serializer, geo, plans } = opts
  const layout = bundle.layout
  // 只覆盖单章时用该章的排版预设，跨章时退回全局（与整篇长图一致）
  const one = plans[0]
  const solo = !!one && plans.every((p) => p.chapterId === one.chapterId)
  const { wrap, flow, vert } = await flowShell(
    layout,
    geo,
    solo ? (one.chapterId ?? null) : null,
    layout.backgrounds.global
  )
  for (const plan of plans) for (const item of plan.items) renderItem(flow, item, serializer)
  return { el: wrap, ...(await measureFlow(wrap, geo, vert)) }
}
