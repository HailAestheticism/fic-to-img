<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DocCardInfo } from '@shared/types'
import { sizeCategory, mmToPx } from '@shared/paper'
import GlyphIcon from '../common/GlyphIcon.vue'
import { useCardMenu } from '../../composables/cardMenu'

const props = withDefaults(
  defineProps<{
    card: DocCardInfo
    /** open：单击进入编辑；detail：单击只看详情（目录树内用） */
    clickMode?: 'open' | 'detail'
    /** 思维导图内可拖动偏移 */
    draggable?: boolean
    offset?: { x: number; y: number }
  }>(),
  { clickMode: 'open', draggable: false, offset: undefined }
)

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'detail'): void
  (e: 'rename'): void
  (e: 'copy'): void
  (e: 'remove'): void
  (e: 'drag-start', ev: PointerEvent): void
}>()

const tileEl = ref<HTMLElement | null>(null)
const bodyEl = ref<HTMLElement | null>(null)
const { isOpen: menuOpen, pos: menuPos, toggle: toggleMenu, close: closeMenu } = useCardMenu()

const card = computed(() => props.card)
const category = computed(() => sizeCategory(card.value.widthMm, card.value.heightMm, card.value.infiniteHeight))
const CATEGORY_GLYPH = { mobile: 'mobile', web: 'web', book: 'book', paper: 'paper' } as const

/** 预览字号：把文档真实字号缩到卡片可读大小 */
function previewSize(size: number, cap: number): number {
  return Math.max(11, Math.min(cap, Math.round(size * 0.62)))
}

const headStyle = computed(() => ({
  fontFamily: card.value.bodyFont || undefined,
  color: card.value.bodyColor
}))

/** 文档名按 H0（文档标题）样式展示：标题字体/颜色 + 正文 × h0Scale */
const titleStyle = computed(() => ({
  fontFamily: card.value.headingFont || card.value.bodyFont || undefined,
  color: card.value.headingColor || card.value.bodyColor,
  fontSize: `${previewSize(card.value.h0Size, 30)}px`,
  lineHeight: '1.35',
  fontWeight: 700
}))

const bodyStyle = computed(() => {
  const lh = parseFloat(card.value.bodyLineHeight)
  return {
    fontFamily: card.value.bodyFont || undefined,
    color: card.value.bodyColor,
    fontSize: `${previewSize(card.value.bodySize, 16)}px`,
    lineHeight: String(Math.min(1.9, Math.max(1.35, Number.isFinite(lh) ? lh : 1.6)))
  }
})

/** ---- 背景：卡片 = 文档背景左上角等尺寸区域的裁切 ---- */
const tileW = ref(0)
const tileH = ref(0)
const REGION_W_MM = 105

const bgLayerStyle = computed<Record<string, string>>(() => {
  const bg = card.value.background
  const style: Record<string, string> = {}
  if (!tileW.value || !bg) return style
  const docW = mmToPx(card.value.widthMm)
  const docH = mmToPx(card.value.heightMm)
  const scale = Math.max(tileW.value / mmToPx(REGION_W_MM), tileW.value / docW, tileH.value / docH)
  const w = Math.round(docW * scale)
  const h = Math.round(docH * scale)
  if (bg.kind === 'color') {
    style.background = bg.color || ''
    return style
  }
  if (bg.kind === 'gradient') {
    style.width = `${w}px`
    style.height = `${h}px`
    style.backgroundImage = bg.gradient || ''
    return style
  }
  if (bg.kind === 'texture') {
    style.backgroundImage = `url("${bg.textureUrl}")`
    style.backgroundRepeat = 'repeat'
    return style
  }
  if (bg.kind === 'image') {
    const multi = bg.multi
    const url = bg.imageUrl ?? multi?.topUrl ?? multi?.midUrl ?? multi?.bottomUrl
    if (!url) {
      if (multi?.midKind === 'color') style.background = multi.midColor || '#ffffff'
      else if (multi?.midKind === 'gradient') style.backgroundImage = multi.midGradient || ''
      return style
    }
    style.width = `${w}px`
    style.height = `${h}px`
    style.backgroundImage = `url("${url}")`
    const fit = bg.imageFit ?? 'fill'
    style.backgroundSize = fit === 'stretch' ? '100% 100%' : fit === 'tile' || fit === 'offset-tile' ? 'auto' : 'cover'
    style.backgroundRepeat = fit === 'tile' || fit === 'offset-tile' ? 'repeat' : 'no-repeat'
    style.backgroundPosition = bg.imageAnchor === 'tl' ? 'left top' : bg.imageAnchor === 'tr' ? 'right top' : 'center'
    style.opacity = String(bg.imageOpacity ?? 1)
  }
  return style
})

const bgBaseStyle = computed(() => {
  const bg = card.value.background
  if (!bg) return {}
  if (bg.kind === 'color' && bg.color) return { background: bg.color }
  if (bg.kind === 'gradient' && bg.gradient) return { background: 'var(--panel-soft)' }
  if (bg.kind === 'texture') return { background: 'var(--panel)' }
  if (bg.kind === 'image') return { background: 'var(--bg)' }
  return {}
})

/** ---- 标题+正文预览的按高截断 ---- */
const title = computed(() => card.value.meta.title)
const snippet = computed(() => card.value.snippet)
const budget = ref(0)
const fitting = ref(false)

interface Segment {
  title: string
  titleEllipsis: boolean
  paras: string[]
}

const segments = computed<Segment>(() => {
  const t = title.value
  const s = snippet.value
  const b = budget.value
  if (b <= 0) return { title: '', titleEllipsis: false, paras: [] }
  if (b < t.length) return { title: t.slice(0, b), titleEllipsis: true, paras: [] }
  const k = Math.min(b - t.length, s.length)
  if (!s) return { title: t, titleEllipsis: false, paras: [] }
  const shown = s.slice(0, k)
  const complete = k >= s.length || s[k] === '\n' || shown.endsWith('\n')
  const paras = shown.replace(/\n+$/, '').split('\n').filter((p, i) => i === 0 || p !== '')
  if (!paras.length) return { title: t, titleEllipsis: false, paras: [] }
  if (!complete) paras[paras.length - 1] = `${paras[paras.length - 1].replace(/\s+$/, '')}…`
  return { title: t, titleEllipsis: false, paras }
})

let ro: ResizeObserver | null = null
let measureToken = 0

async function remeasure(): Promise<void> {
  const token = ++measureToken
  fitting.value = true
  await nextTick()
  const el = bodyEl.value
  if (!el || token !== measureToken) return
  const max = title.value.length + snippet.value.length
  budget.value = max
  await nextTick()
  if (token !== measureToken) return
  if (el.scrollHeight > el.clientHeight + 1) {
    let lo = 0
    let hi = max
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      budget.value = mid
      await nextTick()
      if (token !== measureToken) return
      if (el.scrollHeight <= el.clientHeight + 1) lo = mid
      else hi = mid - 1
    }
    budget.value = lo
    await nextTick()
    if (token !== measureToken) return
  }
  if (token === measureToken) fitting.value = false
}

function observe(): void {
  if (!tileEl.value) return
  ro = new ResizeObserver(() => {
    const r = tileEl.value?.getBoundingClientRect()
    if (!r) return
    if (Math.abs(r.width - tileW.value) < 1 && Math.abs(r.height - tileH.value) < 1) return
    tileW.value = r.width
    tileH.value = r.height
    void remeasure()
  })
  ro.observe(tileEl.value)
}

onMounted(() => {
  observe()
  const r = tileEl.value?.getBoundingClientRect()
  tileW.value = r?.width ?? 0
  tileH.value = r?.height ?? 0
  void remeasure()
})

onBeforeUnmount(() => {
  measureToken++
  ro?.disconnect()
})

watch([snippet, title, () => props.card.charCount], () => void remeasure())

function onTileClick(): void {
  if (dragMoved) return
  if (props.clickMode === 'detail') emit('detail')
  else emit('open')
}

function openMenu(ev: MouseEvent): void {
  ev.stopPropagation()
  toggleMenu(ev.currentTarget as HTMLElement)
}

/* ---- 可选拖动（思维导图）：移动事件由父层处理 ---- */
let dragMoved = false
function onPointerDown(ev: PointerEvent): void {
  if (!props.draggable) return
  dragMoved = false
  emit('drag-start', ev)
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtChars(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n)
}
</script>

<template>
  <article
    ref="tileEl"
    class="doc-tile"
    :class="{ fitting }"
    :style="bgBaseStyle"
    @click="onTileClick"
    @pointerdown="onPointerDown"
  >
    <div v-if="card.background" class="tile-bg" :style="bgLayerStyle" />
    <header class="tile-head">
      <span class="tile-badge" :title="`${category === 'mobile' ? '手机页面' : category === 'web' ? '电脑网页页面' : category === 'book' ? '书籍印刷尺寸' : '标准纸张'}`">
        <GlyphIcon :name="CATEGORY_GLYPH[category]" :size="15" />
      </span>
      <span class="tile-stats" :style="headStyle">
        <span>{{ fmtTime(card.meta.updatedAt) }}</span>
        <span class="tile-chars">{{ fmtChars(card.charCount) }}字</span>
      </span>
      <span class="tile-menu">
        <button class="tile-badge tile-menu-btn" @click="openMenu">
          <GlyphIcon name="menu" :size="15" />
        </button>
      </span>
    </header>
    <div ref="bodyEl" class="tile-body">
      <p class="tile-title" :style="titleStyle">{{ segments.title }}<span v-if="segments.titleEllipsis">…</span></p>
      <p v-for="(p, i) in segments.paras" :key="i" class="tile-para" :style="bodyStyle">{{ p }}</p>
    </div>
    <Teleport to="body">
      <div
        v-if="menuOpen"
        class="menu-pop card-menu"
        :style="{ left: `${menuPos.left}px`, top: `${menuPos.top}px` }"
        @click.stop
      >
        <button @click="closeMenu(); emit('open')">打开</button>
        <button @click="closeMenu(); emit('detail')">详情</button>
        <button @click="closeMenu(); emit('rename')">编辑信息</button>
        <button @click="closeMenu(); emit('copy')">创建副本</button>
        <button class="danger" @click="closeMenu(); emit('remove')">删除</button>
      </div>
    </Teleport>
  </article>
</template>

<style scoped>
.doc-tile {
  position: relative;
  height: var(--tile-h, 232px);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  background: var(--panel);
  transition: box-shadow 0.15s, transform 0.15s, border-color 0.15s;
  user-select: none;
}

.doc-tile:hover {
  box-shadow: var(--shadow);
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.doc-tile.fitting .tile-body {
  opacity: 0.55;
}

.tile-bg {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}

.tile-head {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 0;
}

.tile-badge {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: #fff;
  color: var(--ink);
}

.tile-stats {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 6px 0 4px;
  font-size: 13px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.tile-chars {
  white-space: nowrap;
}

.tile-menu {
  margin-left: auto;
  position: relative;
}

.tile-menu-btn {
  border: 2px solid var(--accent);
  padding: 0;
}

.tile-menu-btn:hover {
  background: var(--accent-soft);
}

.tile-body {
  position: relative;
  padding: 6px 14px 12px;
  max-height: calc(var(--tile-h, 232px) - 46px);
  overflow: hidden;
}

.tile-title {
  font-weight: 600;
  word-break: break-word;
}

.tile-para {
  margin-top: 0.35em;
  word-break: break-word;
}
</style>
