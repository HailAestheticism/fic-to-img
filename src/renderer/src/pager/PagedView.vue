<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Editor } from '@tiptap/core'
import { DOMSerializer, Fragment } from '@tiptap/pm/model'
import type { Node as PMNodeModel } from '@tiptap/pm/model'
import * as fabric from 'fabric'
import type {
  ActivePageInfo,
  BackgroundSpec,
  DocLayout,
  FreeElement,
  LayoutLayer,
  PMNode
} from '@shared/types'
import { api } from '../api'
import { useZoom } from '../composables/zoom'
import { buildExtensions } from '../editor/setup'
import { chaptersOf, type ChapterItem } from '../editor/chapters'
import { genId } from '../editor/id'
import { computeGeometry, geometryForPlan, paginateDoc } from './paginate'
import type { PageGeometry, PagePlan } from './paginate'
import { buildPageElement, layerHost, resolveBackground } from './render-page'
import { applyBackgroundSpec } from './background-render'
import { renderFreeLayerInto } from './free-layer-render'
import {
  createLineObject,
  createShapeObject,
  createStickerObject,
  createTextObject,
  elementsForLayer,
  enlivenElements,
  inferKind,
  type ElementScope
} from '../freelay/fabric-service'

const props = defineProps<{
  content: PMNode
  layout: DocLayout
  docTitle: string
  editable?: boolean
  /** 当前编辑图层（仅 editable 时有意义） */
  layer?: LayoutLayer
  /** 混合界面文本层：正文块可直接点击就地编辑 */
  textEditable?: boolean
  /** 就地编辑时粘贴/拖入图片要写入的文档（assets 归属） */
  docId?: string
}>()

const emit = defineEmits<{
  (e: 'page-activate', info: ActivePageInfo | null): void
  (e: 'update-elements', elements: FreeElement[]): void
  (e: 'selection-change', state: { has: boolean; opacity: number }): void
  (e: 'update-content', json: PMNode): void
  /** 文本层就地编辑的编辑器（null=已提交）；blockKey 供侧栏面板随块切换重建；pos 用于判断是否首块 */
  (e: 'text-editor', ed: Editor | null, blockKey: string, pos: number): void
  /** 章节列表（与分页同源，供混合界面章节导航侧栏） */
  (e: 'chapters', list: ChapterItem[]): void
  /** 滚动后最上方可见页：只用于章节栏高亮，不改动画布激活态 */
  (e: 'visible-page', info: ActivePageInfo | null): void
}>()

const scrollEl = ref<HTMLDivElement>()
const pagesEl = ref<HTMLDivElement>()
const scale = ref(1)
const pageCount = ref(0)
const busy = ref(false)

let editor: Editor | null = null
let hiddenHost: HTMLDivElement | null = null
let lastContentJson = ''
let lastElementsJson = ''
let lastPlanKey = ''
let resizeObserver: ResizeObserver | null = null
let timer: ReturnType<typeof setTimeout> | undefined

interface PageMeta {
  holder: HTMLElement
  paper: HTMLElement
  plan: PagePlan
  geo: PageGeometry
}

let plans: PagePlan[] = []
let meta: PageMeta[] = []
let editing: fabric.Canvas | null = null
let editingIdx = -1
/** 最近一次激活的页：混合界面在文本层与排版图层之间切换时沿用，不必重新点击 */
let lastActivateIdx = -1
let editingLayer: LayoutLayer = 'bg'
let lastScope: ElementScope = { type: 'global' }
let loadingCanvas = false
/**
 * 画布里是否真有用户改动。
 * 换页 / 换图层 / 重新分页都会 disposeEditing(true)，无脑回写会把同一批元素重新序列化
 * 一遍（浮点字段可能微变），于是多出一步「按了撤销却什么都没发生」的记录。
 */
let canvasDirty = false

// ---------- 文本层就地编辑（混合界面） ----------

interface BlockEdit {
  ed: Editor
  mount: HTMLDivElement
  pageIdx: number
  /** 被编辑顶层块在主文档中的起始位置（编辑自身内容不会移动该位置） */
  nodePos: number
  /** 本次编辑在主干上占据的结束位置；块内回车拆分为多块后随之扩展 */
  nodeEnd: number
  /** 同块拆页产生的其他页碎片（编辑期间隐藏，整页重绘时自然恢复） */
  hidden: HTMLElement[]
}

let blockEd: BlockEdit | null = null
let blockSeq = 0
/** 文本层编辑中且分页结构变化波及编辑页时，把整页重绘推迟到提交后 */
let deferredRepaginate = false

function currentLayer(): LayoutLayer {
  return props.layer ?? 'bg'
}

function planKey(): string {
  return JSON.stringify([
    props.layout.pageSetup,
    props.layout.splitRules,
    props.layout.typography,
    props.layout.chapters
  ])
}

function bgForPage(plan: PagePlan): BackgroundSpec | null {
  return resolveBackground(props.layout, plan)
}

onMounted(() => {
  hiddenHost = document.createElement('div')
  hiddenHost.className = 'pagi-hidden-editor'
  document.body.appendChild(hiddenHost)
  editor = new Editor({
    extensions: buildExtensions({ history: false }),
    content: props.content,
    editable: false,
    element: hiddenHost,
    onUpdate: () => {
      // 块编辑自身的同步走 syncBlockEdit 落库；主文档级改动同样只需上报正文
      if (!blockEd) emitMasterContent()
    }
  })
  lastContentJson = JSON.stringify(props.content)
  lastElementsJson = JSON.stringify(props.layout.freeElements)
  lastPlanKey = planKey()
  void repaginate()
  if (scrollEl.value) {
    resizeObserver = new ResizeObserver(scheduleScale)
    resizeObserver.observe(scrollEl.value)
    scrollEl.value.addEventListener('scroll', onScroll, { passive: true })
  }
  pagesEl.value?.addEventListener('click', onCanvasClick)
})

onBeforeUnmount(() => {
  clearTimeout(timer)
  if (scaleRaf) cancelAnimationFrame(scaleRaf)
  scaleRaf = 0
  resizeObserver?.disconnect()
  scrollEl.value?.removeEventListener('scroll', onScroll)
  destroyBlockEdit()
  disposeEditing(false)
  editor?.destroy()
  hiddenHost?.remove()
  editor = null
  hiddenHost = null
})

watch(
  () => props.content,
  (c) => {
    // 与本地记录不一致 = 撤销/重做/预设等同步盘带来的外部改动：立即重排，不等防抖
    if (JSON.stringify(c) !== lastContentJson) void repaginate()
    else schedule()
  }
)
watch(() => props.layout, onLayoutChange, { deep: true })
watch(
  () => props.layer,
  () => void remountEditing()
)
watch(
  () => props.textEditable,
  (v) => {
    if (!v && blockEd) void commitBlockEdit()
  }
)
watch(
  () => [props.editable, props.textEditable] as const,
  ([ed, txt]) => {
    for (const m of meta) {
      m.holder.classList.toggle('clickable', ed)
      m.holder.classList.toggle('text-clickable', !!txt)
    }
    if (!ed) {
      if (editingIdx >= 0) {
        const prev = editingIdx
        disposeEditing(true)
        void renderStaticLayer(prev, 'bg')
        void renderStaticLayer(prev, 'top')
      }
      return
    }
    // 由文本层切回排版图层：沿用之前激活的页，无需再点一次
    if (editingIdx < 0 && lastActivateIdx >= 0) void setActive(lastActivateIdx)
  }
)

function schedule(): void {
  clearTimeout(timer)
  timer = setTimeout(() => void repaginate(), 400)
}

function onLayoutChange(): void {
  const elemsJson = JSON.stringify(props.layout.freeElements)
  const key = planKey()
  if (key !== lastPlanKey) {
    lastPlanKey = key
    schedule()
    return
  }
  const ownSync = elemsJson === lastElementsJson
  lastElementsJson = elemsJson
  void refreshLayersOnly(ownSync)
}

/** 元素/背景变化（不涉及分页结构）：重刷背景样式与两个图层 */
async function refreshLayersOnly(ownSync: boolean): Promise<void> {
  for (const m of meta) await applyBackgroundStyle(m)
  await renderStaticLayers(editingIdx)
  if (!ownSync && editingIdx >= 0 && editing) {
    await rebuildEditingObjects()
  }
}

async function repaginate(): Promise<void> {
  if (!editor || !pagesEl.value || !props.layout) return
  busy.value = true
  try {
    const contentJson = JSON.stringify(props.content)
    const external = contentJson !== lastContentJson
    if (blockEd && (external || planKey() !== blockLayoutKey)) {
      // 外部正文改动（撤销/重做/预设/同步盘）：只波及当前块时把新内容灌回块编辑器，
      // 保住编辑焦点与光标；其余情况（画布设置也变了、前序块移位）结束本次就地编辑。
      const keep = external && planKey() === blockLayoutKey && reloadBlockEdit()
      if (!keep) destroyBlockEdit()
    }
    const prevIdx = editingIdx
    disposeEditing(true)
    if (contentJson !== lastContentJson) {
      lastContentJson = contentJson
      editor.commands.setContent(props.content, { emitUpdate: false })
    }
    const newPlans = paginateDoc(editor.state.doc, editor.schema, props.layout, props.docTitle)
    if (blockEd) {
      // 分页结构未波及编辑页及其之前的页时，只重绘编辑页之后的页面，保持正文编辑焦点
      if (await tryPartialRefresh(newPlans)) return
      deferredRepaginate = true
      return
    }
    deferredRepaginate = false
    plans = newPlans
    pageCount.value = newPlans.length
    await renderPages(plans)
    if (props.editable && prevIdx >= 0 && prevIdx < plans.length) void setActive(prevIdx)
  } finally {
    emitChapters()
    emitVisiblePage()
    busy.value = false
  }
}

/** 逐页形状签名（内容换页判定只依赖块划分，不依赖块内文字） */
function planShape(p: PagePlan): string {
  return p.items
    .map((it) =>
      it.mode === 'whole'
        ? `${it.nodePos}:w`
        : it.mode === 'lines'
          ? `${it.nodePos}:l${it.lineFrom}-${it.lineTo}`
          : `${it.nodePos}:c${it.childFrom}-${it.childTo}`
    )
    .join('|')
}

/** 编辑中：仅重绘编辑页之后的页面；结构波及编辑页及之前时返回 false 由调用方整体推迟 */
async function tryPartialRefresh(newPlans: PagePlan[]): Promise<boolean> {
  const be = blockEd
  const wrap = pagesEl.value
  if (!be || !wrap || !editor) return false
  const editPage = newPlans.findIndex((p) => p.items.some((i) => i.nodePos === be.nodePos))
  if (editPage < 0 || editPage !== be.pageIdx) return false
  for (let i = 0; i <= editPage; i++) {
    if (!meta[i] || !newPlans[i] || planShape(meta[i].plan) !== planShape(newPlans[i])) return false
  }
  const serializer = DOMSerializer.fromSchema(editor.schema)
  for (let i = editPage + 1; i < meta.length; i++) meta[i].holder.remove()
  meta.length = editPage + 1
  for (let i = 0; i <= editPage; i++) {
    meta[i].plan = newPlans[i]
    meta[i].geo = geometryForPlan(props.layout, newPlans[i])
  }
  plans = newPlans
  pageCount.value = newPlans.length
  for (let i = editPage + 1; i < newPlans.length; i++) {
    // 被编辑块的其他页碎片（整块编辑期间的临时重复）不落地，等提交后整体重绘
    const plan = {
      ...newPlans[i],
      items: newPlans[i].items.filter((it) => it.nodePos < be.nodePos || it.nodePos >= be.nodeEnd)
    }
    const geo = geometryForPlan(props.layout, plan)
    const built = await buildHolder(plan, i, newPlans.length, serializer)
    wrap.appendChild(built.holder)
    built.holder.style.width = `${geo.widthPx * scale.value}px`
    built.holder.style.height = `${geo.heightPx * scale.value}px`
    meta.push({ holder: built.holder, paper: built.paper, plan, geo })
    await renderStaticLayer(i, 'bg')
    await renderStaticLayer(i, 'top')
  }
  deferredRepaginate = false
  return true
}

async function buildHolder(
  plan: PagePlan,
  idx: number,
  totalPages: number,
  serializer: DOMSerializer
): Promise<{ holder: HTMLElement; paper: HTMLElement }> {
  const geo = geometryForPlan(props.layout, plan)
  const holder = document.createElement('div')
  holder.className = 'paper-holder'
  // 混合界面切换图层时不会重建议面，故监听始终挂上、类名由 watcher 同步
  holder.classList.toggle('clickable', props.editable)
  holder.classList.toggle('text-clickable', !!props.textEditable)
  holder.addEventListener('click', () => onHolderClick(idx))
  const paper = await buildPageElement({
    plan,
    pageNumber: idx + 1,
    totalPages,
    geometry: geo,
    layout: props.layout,
    docTitle: props.docTitle,
    serializer,
    background: bgForPage(plan)
  })
  holder.appendChild(paper)
  return { holder, paper }
}

async function renderPages(list: PagePlan[]): Promise<void> {
  const wrap = pagesEl.value
  if (!wrap || !editor) return
  wrap.innerHTML = ''
  meta = []
  const serializer = DOMSerializer.fromSchema(editor.schema)
  for (let i = 0; i < list.length; i++) {
    const plan = list[i]
    const geo = geometryForPlan(props.layout, plan)
    const built = await buildHolder(plan, i, list.length, serializer)
    wrap.appendChild(built.holder)
    meta.push({ holder: built.holder, paper: built.paper, plan, geo })
  }
  // 换画布尺寸后 fit 基准可能不同：整幅重排完成时按当前视口重算一次
  updateScale()
  await renderStaticLayers(-1)
}

/**
 * 单击页面进入该页编辑。
 * 已处于该页编辑态时直接返回，不重建画布——重建会吞掉刚完成的选中，
 * 表现为「元素只能拖动、不能单击选中」。
 */
function onHolderClick(idx: number): void {
  if (!props.editable) return
  if (idx === editingIdx) return
  void setActive(idx)
}

// ---------- 文本层就地编辑实现 ----------

let blockLayoutKey = ''

function pageInfoFor(i: number): ActivePageInfo | null {
  const p = plans[i]
  if (!p) return null
  return {
    index: i,
    chapterId: p.chapterId,
    chapterTitle: p.chapterTitle,
    pageIndex: p.pageIndexInChapter
  }
}

function emitMasterContent(): void {
  if (!editor) return
  const json = editor.getJSON() as unknown as PMNode
  lastContentJson = JSON.stringify(json)
  emit('update-content', json)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** 块编辑器内粘贴/拖入图片 → 导入 assets 后插入当前块 */
function importPastedImages(files: FileList | null | undefined): boolean {
  const imgs = Array.from(files ?? []).filter(
    (f) => f.type.startsWith('image/') && f.size <= 20 * 1024 * 1024
  )
  if (!imgs.length) return false
  const ed = blockEd?.ed
  if (ed && props.docId) {
    void (async () => {
      for (const f of imgs) {
        try {
          const base64 = await fileToBase64(f)
          const asset = await api.assets.saveData(props.docId as string, f.name || 'image.png', base64)
          ed.chain().focus().setImage({ src: asset.url, alt: asset.name }).run()
        } catch {
          /* 单张失败不中断其余图片 */
        }
      }
    })()
  }
  return true
}

function onCanvasClick(e: MouseEvent): void {
  if (!props.textEditable || !editor) return
  const t = e.target as HTMLElement
  if (blockEd && (t.closest('.block-edit-mount') || t.closest('.block-edit'))) return
  const blockEl = t.closest<HTMLElement>('.paper-holder .paper-content [data-pm-pos]')
  if (!blockEl) {
    if (blockEd) void commitBlockEdit()
    return
  }
  const holder = blockEl.closest('.paper-holder')
  const pageIdx = meta.findIndex((m) => m.holder === holder)
  if (pageIdx < 0) return
  void startEditAt(Number(blockEl.dataset.pmPos), pageIdx, e)
}

/** 顶层块必须严格从 pos 开始：分页位置一旦过期就宁可放弃编辑，也不能改写错块 */
function topLevelAt(doc: PMNodeModel, pos: number): PMNodeModel | null {
  let found: PMNodeModel | null = null
  doc.forEach((node, offset) => {
    if (offset === pos) found = node
  })
  return found
}

async function startEditAt(renderedPos: number, pageIdx: number, e: MouseEvent): Promise<void> {
  if (!editor) return
  if (blockEd) await commitBlockEdit()
  const node = topLevelAt(editor.state.doc, renderedPos)
  if (!node || node.type.name === 'chapterBreak') return
  const m = meta[pageIdx]
  const el = m?.paper.querySelector<HTMLElement>(
    `.paper-content [data-pm-pos="${renderedPos}"]`
  )
  if (!el) return
  const mount = document.createElement('div')
  mount.className = 'block-edit-mount'
  const ed = new Editor({
    element: mount,
    extensions: buildExtensions({ history: false }),
    // Tiptap v3 会直接把 content 当作 doc 使用：传裸块节点会让 state.doc 变成该块，
    // 其 content 成为行内 Fragment，同步回主文档时 ProseMirror 为「适配」会吞掉相邻块。
    // 因此必须以 doc 包裹，保证块编辑器里的 content 是块级 Fragment。
    content: { type: 'doc', content: [node.toJSON()] },
    editorProps: {
      attributes: {
        class: 'tiptap-prose paged-flow block-edit',
        'data-pm-pos': String(renderedPos)
      },
      handleKeyDown: (_v, ev) => {
        if (ev.key === 'Escape') {
          void commitBlockEdit()
          return true
        }
        return false
      },
      handlePaste: (_v, ev) => importPastedImages(ev.clipboardData?.files),
      handleDrop: (_v, ev, _slice, moved) =>
        moved ? false : importPastedImages(ev.dataTransfer?.files)
    },
    onUpdate: () => syncBlockEdit()
  })
  el.replaceWith(mount)
  const hidden: HTMLElement[] = []
  for (let i = 0; i < meta.length; i++) {
    if (i === pageIdx) continue
    meta[i].paper
      .querySelectorAll<HTMLElement>(`.paper-content [data-pm-pos="${renderedPos}"]`)
      .forEach((h) => {
        h.style.display = 'none'
        hidden.push(h)
      })
  }
  blockEd = {
    ed,
    mount,
    pageIdx,
    nodePos: renderedPos,
    nodeEnd: renderedPos + node.nodeSize,
    hidden
  }
  blockLayoutKey = planKey()
  blockSeq++
  emit('text-editor', ed, `b${blockSeq}`, renderedPos)
  emit('page-activate', pageInfoFor(pageIdx))
  lastActivateIdx = pageIdx
  const c = ed.view.posAtCoords({ left: e.clientX, top: e.clientY })
  ed.commands.focus(c ? c.pos : undefined)
}

/** 顶层块起点之前的结构签名：前序块一旦增删改，nodePos 就不可信 */
function prefixSignature(doc: PMNodeModel, pos: number): string {
  const parts: string[] = []
  doc.forEach((child, offset) => {
    if (offset < pos) parts.push(JSON.stringify(child.toJSON()))
  })
  return parts.join('|')
}

/** 把「块内第 n 个字符」换算成块编辑器里的位置（撤销后尽量放回原光标） */
function posAtTextOffset(doc: PMNodeModel, target: number): number {
  let acc = 0
  let res = doc.content.size
  let hit = false
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (hit) return false
    if (!node.isText) return true
    if (acc + node.nodeSize >= target) {
      res = pos + Math.max(0, target - acc)
      hit = true
      return false
    }
    acc += node.nodeSize
    return true
  })
  return res
}

/**
 * 撤销/重做只改动当前编辑块时：把主文档里的新版本灌回块编辑器。
 * @returns false 表示位置已不可信（前序结构变化），调用方应结束本次就地编辑
 */
function reloadBlockEdit(): boolean {
  const be = blockEd
  if (!be || !editor) return false
  let restored: PMNodeModel
  try {
    restored = editor.schema.nodeFromJSON(props.content)
  } catch {
    return false
  }
  if (prefixSignature(restored, be.nodePos) !== prefixSignature(editor.state.doc, be.nodePos)) {
    return false
  }
  const node = topLevelAt(restored, be.nodePos)
  if (!node) return false
  const ed = be.ed
  const hadFocus = ed.isFocused
  const state = ed.state
  const caretOffset = state.doc.textBetween(0, Math.min(state.selection.from, state.doc.content.size), '', '').length
  try {
    ed.commands.setContent({ type: 'doc', content: [node.toJSON()] }, { emitUpdate: false })
  } catch {
    return false
  }
  be.nodeEnd = be.nodePos + node.nodeSize
  ed.commands.setTextSelection(posAtTextOffset(ed.state.doc, caretOffset))
  if (hadFocus) ed.commands.focus()
  return true
}

function syncBlockEdit(): void {
  if (!blockEd || !editor) return
  const doc = editor.state.doc
  const from = blockEd.nodePos
  const to = Math.min(blockEd.nodeEnd, doc.content.size)
  // 位置过期（外部改动/重排）时放弃本次同步，绝不改写错块
  if (to <= from || !topLevelAt(doc, from)) return
  const schema = editor.state.schema
  const blockDoc = blockEd.ed.state.doc
  let frag: Fragment
  try {
    // 块编辑器与隐藏主编辑器是两套 Schema 实例：类型按对象身份比较，
    // 直接拿块编辑器的节点替换会让 ProseMirror 判定「放不进父节点」而吞掉相邻块。
    // 因此统一用主 Schema 从 JSON 重建。
    frag = Fragment.fromJSON(schema, blockDoc.content.toJSON())
  } catch {
    return
  }
  if (!frag.size) {
    frag = Fragment.from(schema.nodes.paragraph.createAndFill()!)
  }
  const tr = editor.state.tr.replaceWith(from, to, frag)
  editor.view.dispatch(tr)
  blockEd.nodeEnd = from + frag.size
  emitMasterContent()
}

function destroyBlockEdit(): void {
  if (!blockEd) return
  const be = blockEd
  blockEd = null
  be.ed.destroy()
  be.mount.remove()
  be.hidden.forEach((h) => (h.style.display = ''))
  emit('text-editor', null, '', -1)
}

async function commitBlockEdit(): Promise<void> {
  const had = !!blockEd
  if (had) destroyBlockEdit()
  if (had || deferredRepaginate) await repaginate()
}

async function applyBackgroundStyle(m: PageMeta): Promise<void> {
  await applyBackgroundSpec(m.paper, bgForPage(m.plan))
}

/** 渲染所有非编辑中页面的两个图层 */
async function renderStaticLayers(except: number): Promise<void> {
  for (let i = 0; i < meta.length; i++) {
    if (i === except) {
      const other = (['bg', 'top'] as LayoutLayer[]).find((l) => l !== editingLayer)
      if (other) await renderStaticLayer(i, other)
      continue
    }
    await renderStaticLayer(i, 'bg')
    await renderStaticLayer(i, 'top')
  }
}

async function renderStaticLayer(i: number, l: LayoutLayer): Promise<void> {
  const m = meta[i]
  const host = m && layerHost(m.paper, l)
  if (!m || !host) return
  host.style.pointerEvents = 'none'
  const list = elementsForLayer(props.layout, m.plan, l)
  await renderFreeLayerInto(host, list, m.geo, 1)
}

async function remountEditing(): Promise<void> {
  if (editingIdx < 0) return
  const idx = editingIdx
  disposeEditing(true)
  await setActive(idx)
}

async function setActive(idx: number): Promise<void> {
  if (!props.editable || !meta[idx]) return
  const prev = editingIdx
  disposeEditing(true)
  if (prev >= 0 && prev !== idx) {
    await renderStaticLayer(prev, 'bg')
    await renderStaticLayer(prev, 'top')
  }
  editingIdx = idx
  lastActivateIdx = idx
  editingLayer = currentLayer()
  meta.forEach((m, i) => m.holder.classList.toggle('active', i === idx))

  const m = meta[idx]
  const host = layerHost(m.paper, editingLayer)
  if (!host) return
  host.innerHTML = ''
  host.style.pointerEvents = 'auto'
  const canvasEl = document.createElement('canvas')
  host.appendChild(canvasEl)
  const g = m.geo
  editing = new fabric.Canvas(canvasEl, {
    width: g.widthPx,
    height: g.heightPx,
    enableRetinaScaling: false,
    preserveObjectStacking: true,
    selection: true
  })
  editing.backgroundColor = 'transparent'
  const markDirty = (): void => {
    if (!loadingCanvas) canvasDirty = true
  }
  editing.on('object:modified', () => {
    markDirty()
    syncFromCanvas()
  })
  editing.on('object:added', (e) => {
    if (!e.target?.elementId) e.target?.set('elementId', genId())
    if (loadingCanvas) return
    markDirty()
    syncFromCanvas()
  })
  editing.on('object:removed', () => {
    if (loadingCanvas) return
    markDirty()
    syncFromCanvas()
  })
  // 双击改文字内容不会触发 object:modified，但要能撤销
  editing.on('text:changed', () => markDirty())
  const emitSel = (): void => {
    const o = editing?.getActiveObject()
    emit('selection-change', { has: !!o, opacity: (o?.opacity as number) ?? 1 })
  }
  editing.on('selection:created', emitSel)
  editing.on('selection:updated', emitSel)
  editing.on('selection:cleared', () => emit('selection-change', { has: false, opacity: 1 }))

  loadingCanvas = true
  const objs = await enlivenElements(elementsForLayer(props.layout, m.plan, editingLayer))
  if (!editing) return
  objs.forEach((o) => editing!.add(o))
  loadingCanvas = false
  editing.renderAll()
  await renderStaticLayer(idx, editingLayer === 'bg' ? 'top' : 'bg')
  emit('page-activate', {
    index: idx,
    chapterId: m.plan.chapterId,
    chapterTitle: m.plan.chapterTitle,
    pageIndex: m.plan.pageIndexInChapter
  })
}

function disposeEditing(sync: boolean): void {
  if (sync && editing && canvasDirty) syncFromCanvas()
  editing?.dispose()
  editing = null
  editingIdx = -1
}

function sameElementSet(a: FreeElement[], b: FreeElement[]): boolean {
  if (a.length !== b.length) return false
  const key = (list: FreeElement[]): string =>
    JSON.stringify([...list].sort((x, y) => x.id.localeCompare(y.id)))
  return key(a) === key(b)
}

/** 把编辑画布的当前状态同步回 layout.freeElements（仅本图层本页） */
function syncFromCanvas(): void {
  if (!editing || editingIdx < 0 || !meta[editingIdx]) return
  const plan = meta[editingIdx].plan
  const old = elementsForLayer(props.layout, plan, editingLayer)
  const oldById = new Map(old.map((e) => [e.id, e]))
  const pageEls: FreeElement[] = editing.getObjects().map((o, i) => {
    if (!o.elementId) o.set('elementId', genId())
    const id = o.elementId as string
    const prev = oldById.get(id)
    return {
      id,
      layer: editingLayer,
      scope: prev?.scope ?? lastScope,
      kind: prev?.kind ?? inferKind(o),
      data: o.toObject(['elementId']) as Record<string, any>,
      z: i
    }
  })
  const pageIds = new Set(pageEls.map((p) => p.id))
  const rest = props.layout.freeElements.filter((e) => !pageIds.has(e.id))
  const merged = [...rest, ...pageEls]
  lastElementsJson = JSON.stringify(merged)
  // 元素只按 id 归类、层内次序由 z 决定：集合等价（仅数组顺序不同）就不算改动。
  // 否则「重新分页 → 画布回写」会被记成一步撤销，撤销一次反而把 redo 链冲断。
  canvasDirty = false
  if (sameElementSet(merged, props.layout.freeElements)) return
  emit('update-elements', merged)
}

async function rebuildEditingObjects(): Promise<void> {
  if (!editing || editingIdx < 0 || !meta[editingIdx]) return
  editing.getObjects().forEach((o) => editing!.remove(o))
  loadingCanvas = true
  const objs = await enlivenElements(elementsForLayer(props.layout, meta[editingIdx].plan, editingLayer))
  objs.forEach((o) => editing!.add(o))
  loadingCanvas = false
  editing.renderAll()
}

// ---------- 面板调用的编辑操作 ----------

async function ensureEditing(): Promise<boolean> {
  if (!props.editable) return false
  if (editingIdx >= 0 && editing && editingLayer === currentLayer()) return true
  if (!meta.length) return false
  await setActive(editingIdx >= 0 ? editingIdx : 0)
  return !!editing
}

async function addFreeElement(
  kind: FreeElement['kind'],
  scope: ElementScope,
  opts?: { src?: string; variant?: string }
): Promise<void> {
  if (!(await ensureEditing())) return
  lastScope = scope
  const g = editingIdx >= 0 ? meta[editingIdx].geo : computeGeometry(props.layout)
  let obj: fabric.FabricObject | null = null
  if (kind === 'shape') obj = createShapeObject((opts?.variant as 'rect' | 'circle' | 'triangle') ?? 'rect', g)
  else if (kind === 'line') obj = createLineObject(g)
  else if (kind === 'text') obj = createTextObject(g, false)
  else if (kind === 'watermark') obj = createTextObject(g, true)
  else if (kind === 'sticker' && opts?.src) obj = await createStickerObject(opts.src, g)
  if (!obj) return
  if (!obj.elementId) obj.set('elementId', genId())
  editing!.add(obj)
  editing!.setActiveObject(obj)
  editing!.renderAll()
}

function deleteSelected(): void {
  if (!editing) return
  editing.getActiveObjects().forEach((o) => editing!.remove(o))
  editing.discardActiveObject()
  editing.renderAll()
}

async function duplicateSelected(): Promise<void> {
  if (!editing) return
  const act = editing.getActiveObject()
  if (!act) return
  const clone = await act.clone(['elementId'])
  clone.set({ left: (act.left ?? 0) + 18, top: (act.top ?? 0) + 18 })
  clone.set('elementId', genId())
  editing.add(clone)
  editing.setActiveObject(clone)
  editing.renderAll()
}

function setOpacitySelected(v: number): void {
  if (!editing) return
  editing.getActiveObjects().forEach((o) => o.set('opacity', v))
  editing.renderAll()
  canvasDirty = true
  syncFromCanvas()
}

function setBrush(on: boolean): void {
  if (!editing) return
  editing.isDrawingMode = on
  if (on) {
    const brush = new fabric.PencilBrush(editing)
    brush.color = 'rgba(138, 109, 59, 0.85)'
    brush.width = 4
    editing.freeDrawingBrush = brush
  }
}

defineExpose({
  gotoPos,
  insertBreakBefore,
  addFreeElement,
  deleteSelected,
  duplicateSelected,
  setOpacitySelected,
  setBrush
})

// ---------- 章节导航（混合界面文本层的章节侧栏用） ----------

function emitChapters(): void {
  if (!editor || !props.layout) return
  emit(
    'chapters',
    chaptersOf(editor.state.doc, props.layout.splitRules, props.docTitle)
  )
}

let visibleRaf = 0
let lastVisibleKey = ''

function onScroll(): void {
  if (visibleRaf) return
  visibleRaf = requestAnimationFrame(() => {
    visibleRaf = 0
    emitVisiblePage()
  })
}

/** 顶边最先露出来的那一页即「当前页」，只在变化时回报 */
function emitVisiblePage(): void {
  const box = scrollEl.value
  if (!box) return
  const top = box.getBoundingClientRect().top
  let idx = 0
  for (let i = 0; i < meta.length; i++) {
    if (meta[i].holder.getBoundingClientRect().bottom - top > 8) {
      idx = i
      break
    }
  }
  const info = pageInfoFor(idx)
  const key = info ? `${info.chapterId}:${info.pageIndex}` : ''
  if (key === lastVisibleKey) return
  lastVisibleKey = key
  emit('visible-page', info)
}

/**
 * 滚到该章的第一页。章节符不占版面（它是章首标记而非正文项），所以只按正文位置找会
 * 落到上一页，故优先用 chapterId 定位；无 id 的自动分章再回落到位置算法。
 * 排版图层顺带激活该页。
 */
function gotoPos(pos: number, chapterId?: string): void {
  const box = scrollEl.value
  if (!box || !meta.length) return
  let idx = chapterId ? plans.findIndex((p) => p.chapterId === chapterId) : -1
  if (idx < 0) {
    idx = 0
    for (let i = 0; i < plans.length; i++) {
      const items = plans[i].items
      if (!items.length) continue
      if (items[0].nodePos <= pos) idx = i
      else break
    }
  }
  const m = meta[idx]
  if (!m) return
  box.scrollTo({ top: Math.max(0, m.holder.offsetTop - 16), behavior: 'smooth' })
  emit('page-activate', pageInfoFor(idx))
  if (props.editable && editingIdx !== idx) void setActive(idx)
}

/** 在正文位置 pos 前插入章节符；先提交在编辑的块，避免位置漂移改写错块 */
async function insertBreakBefore(pos: number): Promise<void> {
  if (!editor) return
  const doc = editor.state.doc
  if (pos <= 0 || pos > doc.content.size) return
  const type = editor.schema.nodes.chapterBreak
  if (!type) return
  if (blockEd) await commitBlockEdit()
  const tr = editor.state.tr.insert(pos, type.createAndFill() ?? type.create())
  editor.view.dispatch(tr)
  emitMasterContent()
}

// ---------- 缩放 ----------

let scaleRaf = 0
const zoom = useZoom()

function scheduleScale(): void {
  if (scaleRaf) return
  scaleRaf = requestAnimationFrame(() => {
    scaleRaf = 0
    updateScale()
  })
}

/**
 * 界面缩放（阶段 24）：自适应 fit（竖向画布完整放进视口）即用户的 100%，
 * 最终显示比例 = fit × 缩放百分比。自定义超大画布靠 fit 保证最短边始终完整可见。
 */
function updateScale(): void {
  if (!props.layout) return
  const w = meta[0]?.geo.widthPx ?? geometryForPlan(props.layout, plans[0]).widthPx
  const avail = (scrollEl.value?.clientWidth ?? 900) - 64
  const fit = Math.max(0.2, Math.min(1, avail / w))
  scale.value = fit * zoom.factor.value
  applyScale()
}

/** 缩放百分比变化（含右下角按钮、Ctrl+滚轮、重置回 100%）：立即重算显示比例 */
watch(
  () => zoom.factor.value,
  () => updateScale()
)

function applyScale(): void {
  const wrap = pagesEl.value
  if (!wrap) return
  wrap.style.setProperty('--paper-scale', String(scale.value))
  for (const m of meta) {
    m.holder.style.width = `${m.geo.widthPx * scale.value}px`
    m.holder.style.height = `${m.geo.heightPx * scale.value}px`
  }
}
</script>

<template>
  <div ref="scrollEl" class="paged-scroll">
    <div v-if="textEditable" class="paged-hint">点击页面正文即可就地改字 · Esc 或点击空白处结束编辑</div>
    <div v-else-if="editable" class="paged-hint">点击页面进入该页的{{ layer === 'top' ? '顶层' : '背景层' }}编辑</div>
    <div ref="pagesEl" class="pages-flow" />
    <div v-if="busy" class="pagi-busy">排版中…</div>
  </div>
</template>
