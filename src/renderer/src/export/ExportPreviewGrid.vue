<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DocBundle } from '@shared/types'
import { computeGeometry, isInfinite, paginateDoc } from '../pager/paginate'
import {
  buildFullPageEl,
  buildLongFlowEl,
  buildPlansFlowEl,
  createExportEditor,
  settle,
  type ExportEditor
} from './render-shared'

const props = defineProps<{
  bundle: DocBundle
  /** frames = 逐章/逐页各一框（你会拿到若干文件）；flow = 整幅一图一框 */
  mode: 'frames' | 'flow'
  /** 导出范围（决定画廊只显示将被导出的内容） */
  range: 'all' | 'chapters' | 'pages'
  chapterIds: string[]
  /** 页是否可点选（导出范围=部分页） */
  selectable: boolean
  /** range=pages 时选中的全局页序 */
  selected: number[]
}>()
const emit = defineEmits<{ (e: 'toggle', index: number): void }>()

const rootEl = ref<HTMLDivElement>()

let ed: ExportEditor | null = null
let edFor: DocBundle | null = null

interface ThumbItem {
  el: HTMLElement
  w: number
  h: number
  /** 分页画布的页序（点选与过滤用）；长图/整幅框为 -1 */
  index: number
  chapterId: string
  chapterTitle: string
  isChapterStart: boolean
}
let items: ThumbItem[] = []
let ro: ResizeObserver | null = null
let buildToken = 0

function clearItems(): void {
  items = []
  if (rootEl.value) rootEl.value.innerHTML = ''
}

async function rebuild(): Promise<void> {
  const token = ++buildToken
  clearItems()
  const bundle = props.bundle
  if (!bundle || !rootEl.value) return
  if (ed && edFor !== bundle) {
    ed.destroy()
    ed = null
  }
  if (!ed) {
    ed = createExportEditor(bundle)
    edFor = bundle
  }
  const layout = bundle.layout
  const inf = isInfinite(layout)
  const geo = computeGeometry(layout)
  const plans = paginateDoc(ed.editor.state.doc, ed.editor.schema, layout, bundle.meta.title)
  const pushFlow = (
    f: { el: HTMLElement; widthCss: number; heightCss: number },
    chapterId: string,
    chapterTitle: string
  ) => {
    items.push({
      el: f.el,
      w: f.widthCss,
      h: f.heightCss,
      index: -1,
      chapterId,
      chapterTitle,
      isChapterStart: false
    })
  }

  if (props.mode === 'flow') {
    // 整幅一图：全文＝整篇流式，部分选择＝所选内容首尾相接
    const chapterSet = new Set(props.chapterIds)
    const pageSet = new Set(props.selected)
    const sel =
      props.range === 'chapters'
        ? plans.filter((p) => chapterSet.has(p.chapterId))
        : props.range === 'pages'
          ? plans.filter((_, i) => pageSet.has(i))
          : plans
    if (!sel.length) {
      if (token !== buildToken) return
      layoutGrid()
      return
    }
    const built =
      props.range === 'all'
        ? await buildLongFlowEl({ bundle, editor: ed.editor, serializer: ed.serializer, geo, chapterId: null })
        : await buildPlansFlowEl({ bundle, serializer: ed.serializer, geo, plans: sel })
    if (token !== buildToken) return
    pushFlow(built, '', `整幅一图 · ${sel.length} ${inf ? '章' : '页'}`)
  } else if (inf) {
    // 无限画布：一章一条长图，逐章成框（不带页码，只标章节）
    const seen: string[] = []
    for (const plan of plans) {
      if (seen.includes(plan.chapterId)) continue
      seen.push(plan.chapterId)
      if (token !== buildToken) return
      const f = await buildLongFlowEl({
        bundle,
        editor: ed.editor,
        serializer: ed.serializer,
        geo,
        chapterId: plan.chapterId
      })
      pushFlow(f, plan.chapterId, plan.chapterTitle)
    }
  } else {
    for (let i = 0; i < plans.length; i++) {
      if (token !== buildToken) return
      const { el, geo: g } = await buildFullPageEl({
        bundle,
        plan: plans[i],
        pageNumber: i + 1,
        totalPages: plans.length,
        serializer: ed.serializer,
        multiplier: 1
      })
      await settle(el)
      items.push({
        el,
        w: g.widthPx,
        h: g.heightPx,
        index: i,
        chapterId: plans[i].chapterId,
        chapterTitle: plans[i].chapterTitle,
        isChapterStart: plans[i].isChapterStart
      })
    }
  }
  if (token !== buildToken) return
  layoutGrid()
}

/** 画廊只显示将被导出的内容：按范围过滤已建好的框 */
function visibleItems(): ThumbItem[] {
  if (props.mode === 'flow') return items
  if (props.range === 'chapters') {
    const s = new Set(props.chapterIds)
    return items.filter((it) => s.has(it.chapterId))
  }
  if (props.range === 'pages') {
    const s = new Set(props.selected)
    return items.filter((it) => s.has(it.index))
  }
  return items
}

/** 缩略图最小尺寸：够放下角标「第N章 + 章节名前 2 字」（11px 字号 × 7 字 + 内边距） */
const MIN_THUMB_W = 110
const MIN_THUMB_H = 64
/** .exg-board 的左右内边距 */
const PAD = 24

function maxW(): number {
  return Math.max(...items.map((i) => i.w), 1)
}

/** 平铺：在 1..N 列中挑出让缩略图显示得最大的列数（较优解），整幅不滚动 */
function pickCols(N: number, W: number, H: number, gap: number): { cols: number; scale: number } {
  let best = { cols: 1, scale: -1 }
  for (let c = 1; c <= N; c++) {
    const r = Math.ceil(N / c)
    const cellW = (W - (c - 1) * gap - PAD) / c
    const cellH = (H - (r - 1) * gap - PAD) / r
    if (cellW <= 4 || cellH <= 4) continue
    let s = 1
    for (const it of items) s = Math.min(s, cellW / it.w, cellH / it.h)
    if (s > best.scale + 1e-9) best = { cols: c, scale: s }
  }
  return best
}

/**
 * 排布方案：先试「全部塞进一屏」的较优解；若缩略图会小到放不下角标，
 * 就退到按最小宽度平铺并开启上下滚动。
 * 长图模式（无限画布）不适用——那里要求整幅长图完整可见。
 */
function planGrid(
  N: number,
  W: number,
  H: number,
  gap: number,
  respectMin: boolean
): { cols: number; scale: number; scroll: boolean } {
  const fit = pickCols(N, W, H, gap)
  const minScale = Math.max(MIN_THUMB_W / maxW(), MIN_THUMB_H / Math.max(...items.map((i) => i.h), 1))
  if (!respectMin || fit.scale >= minScale) return { ...fit, scroll: false }
  const cols = Math.max(1, Math.min(N, Math.floor((W - PAD + gap) / (MIN_THUMB_W + gap))))
  const cellW = (W - PAD - (cols - 1) * gap) / cols
  return { cols, scale: Math.min(1, cellW / maxW()), scroll: true }
}

/** 窄缩略图上的章节角标：放不下时退成「第N章 + 名称前 2 字」 */
function badgeText(title: string, frameW: number): string {
  if (title.length * 11 + 12 <= frameW - 8) return title
  const m = /^(第[0-9〇零一二三四五六七八九十百千两]+[章节回]\s*)(.*)$/s.exec(title)
  if (m) return m[1] + [...m[2].trimStart()].slice(0, 2).join('')
  return [...title].slice(0, 2).join('')
}

function layoutGrid(): void {
  const root = rootEl.value
  if (!root) return
  root.innerHTML = ''
  const vis = visibleItems()
  if (!vis.length) {
    const tip = document.createElement('div')
    tip.className = 'exg-empty'
    tip.textContent =
      props.range === 'pages' ? '尚未选中任何页' : props.range === 'chapters' ? '尚未选中任何章节' : '没有可显示的内容'
    root.appendChild(tip)
    return
  }
  const GAP = 14
  // 整幅一图必须完整可见（不适用最小尺寸）；逐框模式放不下时改为按最小尺寸平铺 + 上下滚动
  const respectMin = props.mode === 'frames'
  const { cols, scale, scroll } = planGrid(vis.length, root.clientWidth, root.clientHeight, GAP, respectMin)
  if (scale <= 0) return
  const rows = Math.ceil(vis.length / cols)
  root.style.overflowY = scroll ? 'auto' : 'hidden'
  const board = document.createElement('div')
  board.className = 'exg-board'
  board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`
  board.style.gap = `${GAP}px`
  if (scroll) {
    board.style.height = 'auto'
    board.style.gridAutoRows = 'max-content'
  } else {
    board.style.gridTemplateRows = `repeat(${rows}, 1fr)`
  }
  vis.forEach((it, n) => {
    const cell = document.createElement('div')
    cell.className = 'exg-cell'
    const frame = document.createElement('div')
    frame.className = 'exg-frame'
    const fw = Math.round(it.w * scale)
    const fh = Math.round(it.h * scale)
    frame.style.width = `${fw}px`
    frame.style.height = `${fh}px`
    it.el.style.transform = `scale(${scale})`
    it.el.style.transformOrigin = '0 0'
    frame.appendChild(it.el)

    if (it.index >= 0) {
      const no = document.createElement('span')
      no.className = 'exg-tag exg-tag-no'
      no.textContent = `${n + 1} / ${vis.length}`
      frame.appendChild(no)
    }
    if (it.index < 0 || it.isChapterStart) {
      const ch = document.createElement('span')
      ch.className = 'exg-tag exg-tag-ch'
      ch.textContent = badgeText(it.chapterTitle, fw)
      frame.appendChild(ch)
    }
    if (props.selectable && it.index >= 0) {
      cell.classList.add('clickable')
      if (props.selected.includes(it.index)) cell.classList.add('sel')
      cell.addEventListener('click', () => emit('toggle', it.index))
    }
    cell.appendChild(frame)
    board.appendChild(cell)
  })
  root.appendChild(board)
}

onMounted(() => {
  rebuild()
  ro = new ResizeObserver(() => layoutGrid())
  if (rootEl.value) ro.observe(rootEl.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  ro = null
  ed?.destroy()
  ed = null
  edFor = null
  clearItems()
})

watch(
  () => [props.bundle, props.mode] as const,
  () => {
    if (props.bundle) rebuild()
  }
)
watch(
  () => [props.range, props.chapterIds.join(','), props.selected.join(',')] as const,
  () => {
    if (!props.bundle) return
    // 逐框模式只是换显示子集；整幅一图的内容随选中范围而变，必须重建
    if (props.mode === 'flow') rebuild()
    else layoutGrid()
  }
)
</script>

<template>
  <div class="exg-root">
    <div ref="rootEl" class="exg-holder" />
  </div>
</template>

<style scoped>
.exg-root {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  background: var(--panel-soft);
}

.exg-holder {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

:deep(.exg-board) {
  display: grid;
  width: 100%;
  height: 100%;
  padding: 12px;
  box-sizing: border-box;
}

:deep(.exg-cell) {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  min-height: 0;
}

:deep(.exg-cell.clickable) {
  cursor: pointer;
}

:deep(.exg-frame) {
  position: relative;
  overflow: hidden;
  background: #fff;
  border: 2px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 8%);
  flex-shrink: 0;
}

:deep(.exg-cell.sel .exg-frame) {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

:deep(.exg-cell.clickable:hover .exg-frame) {
  border-color: var(--accent);
}

:deep(.exg-tag) {
  position: absolute;
  z-index: 2;
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  background: rgb(0 0 0 / 55%);
  color: #fff;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.exg-tag-no) {
  right: 4px;
  bottom: 4px;
}

:deep(.exg-tag-ch) {
  left: 4px;
  top: 4px;
}

:deep(.exg-empty) {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--muted);
}
</style>
