<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DocCardInfo, DocMeta } from '@shared/types'
import { useLibraryStore } from '../../stores/library'
import type { FolderNode } from '../../stores/library'
import DocCardTile from './DocCardTile.vue'
import GlyphIcon from '../common/GlyphIcon.vue'

type MindMode = 'mind' | 'logic' | 'arch'

const lib = useLibraryStore()

const emit = defineEmits<{
  (e: 'open-doc', doc: DocMeta): void
  (e: 'detail-card', card: DocCardInfo): void
  (e: 'rename-doc', doc: DocMeta): void
  (e: 'copy-doc', doc: DocMeta): void
  (e: 'remove-doc', doc: DocMeta): void
}>()

/** 思维导图（放射，默认）/ 逻辑图（左→右）/ 架构图（逻辑图顺时针旋转 90°） */
const mode = ref<MindMode>((localStorage.getItem('fictoimg.library.mindMode') as MindMode) || 'mind')
const folderWidthMode = ref<'card' | 'fit'>(
  (localStorage.getItem('fictoimg.library.mindFolderW') as 'card' | 'fit') || 'fit'
)
watch(mode, (m) => localStorage.setItem('fictoimg.library.mindMode', m))
watch(folderWidthMode, (m) => localStorage.setItem('fictoimg.library.mindFolderW', m))

const zoom = ref(1)
const collapsed = ref<Set<string>>(new Set())
/** 用户拖动产生的位移（按节点 id），沿父子链向下传递 */
const offsets = ref<Record<string, { x: number; y: number }>>({})

const DOC_W = 320
const DOC_H = 162
const FOLDER_H = 40
const GAP_MAIN = 70
const GAP_CROSS = 18
const CENTER_GAP = 80

interface TreeNode {
  id: string
  kind: 'folder' | 'doc'
  label: string
  node?: FolderNode
  card?: DocCardInfo
  children: TreeNode[]
}

function buildTreeNode(n: FolderNode): TreeNode {
  const kids: TreeNode[] = n.children.map(buildTreeNode)
  for (const d of n.docs) {
    const c = lib.cardById[d.id]
    if (c) kids.push({ id: `d:${d.id}`, kind: 'doc', label: d.title, card: c, children: [] })
  }
  return { id: `f:${n.path}`, kind: 'folder', label: n.name, node: n, children: kids }
}

function folderMainSize(name: string): number {
  return folderWidthMode.value === 'card' ? DOC_W : Math.min(DOC_W, Math.max(120, name.length * 15 + 72))
}

function nodeSize(t: TreeNode): { main: number; cross: number } {
  return t.kind === 'doc' ? { main: DOC_W, cross: DOC_H } : { main: folderMainSize(t.label), cross: FOLDER_H }
}

/** 子树在横轴（与生长方向垂直）上的占用，按全展开计算 */
function subtreeCross(t: TreeNode): number {
  if (!t.children.length) return nodeSize(t).cross
  let sum = 0
  t.children.forEach((c, i) => {
    sum += subtreeCross(c) + (i > 0 ? GAP_CROSS : 0)
  })
  return Math.max(sum, nodeSize(t).cross)
}

interface LayoutNode {
  id: string
  kind: 'folder' | 'doc' | 'center'
  base: { x: number; y: number; w: number; h: number }
  label: string
  card?: DocCardInfo
  node?: FolderNode
}

interface LayoutEdge {
  id: string
  parentId: string
  childId: string
  axis: 'h' | 'v'
  dir: 1 | -1
  childIsFolder: boolean
}

interface TreeLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * cols: depth → 主轴位置。
 * h/dir=1：cols[d] 为节点左边缘；h/dir=-1：cols[d] 为节点右边缘；v：cols[d] 为上边缘。
 */
function placeNode(
  t: TreeNode,
  axis: 'h' | 'v',
  dir: 1 | -1,
  depth: number,
  crossStart: number,
  cols: Record<number, number>,
  out: TreeLayout,
  parent: { id: string } | null
): number {
  const m = nodeSize(t)
  let crossCenter: number
  if (t.children.length) {
    let cursor = crossStart
    const first = cursor
    for (const c of t.children) {
      cursor = placeNode(c, axis, dir, depth + 1, cursor, cols, out, t) + GAP_CROSS
    }
    const last = cursor - GAP_CROSS
    crossCenter = (first + last) / 2
  } else {
    crossCenter = crossStart + m.cross / 2
  }
  const node: LayoutNode = {
    id: t.id,
    kind: t.kind,
    base: { x: 0, y: 0, w: m.main, h: m.cross },
    label: t.label,
    card: t.card,
    node: t.node
  }
  if (axis === 'h') {
    node.base.y = crossCenter - m.cross / 2
    node.base.x = dir === 1 ? cols[depth] : cols[depth] - m.main
  } else {
    node.base.x = crossCenter - m.main / 2
    node.base.y = cols[depth]
  }
  out.nodes.push(node)
  out.minX = Math.min(out.minX, node.base.x)
  out.maxX = Math.max(out.maxX, node.base.x + node.base.w)
  out.minY = Math.min(out.minY, node.base.y)
  out.maxY = Math.max(out.maxY, node.base.y + node.base.h)
  if (parent) out.edges.push({ id: `${parent.id}->${node.id}`, parentId: parent.id, childId: node.id, axis, dir, childIsFolder: t.kind === 'folder' })
  return crossCenter + m.cross / 2
}

function buildCols(
  depthSizes: Record<number, number>,
  axis: 'h' | 'v',
  dir: 1 | -1,
  originMain: number,
  startDepth: number
): Record<number, number> {
  const cols: Record<number, number> = {}
  let acc = originMain
  for (let d = startDepth; d <= maxDepth(depthSizes); d++) {
    if (d > startDepth) acc += (dir === 1 ? 1 : -1) * (depthSizes[d - 1] + GAP_MAIN)
    cols[d] = acc
  }
  return cols
}

function maxDepth(map: Record<number, number>): number {
  return Math.max(...Object.keys(map).map(Number))
}

function collectDepthSizes(t: TreeNode, depth: number, map: Record<number, number>): void {
  map[depth] = Math.max(map[depth] ?? 0, nodeSize(t).main)
  for (const c of t.children) collectDepthSizes(c, depth + 1, map)
}

/** 单棵中心树的完整布局 */
function layoutCenter(t: TreeNode, m: MindMode): TreeLayout {
  const out: TreeLayout = { nodes: [], edges: [], minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  const depthSizes: Record<number, number> = {}
  collectDepthSizes(t, 0, depthSizes)

  if (m === 'mind') {
    // 一级孩子按横轴占用均衡分到左右两侧
    const kids = t.children
    const ext = kids.map(subtreeCross)
    const total = ext.reduce((a, b) => a + b + GAP_CROSS, -GAP_CROSS)
    const right: TreeNode[] = []
    const left: TreeNode[] = []
    let run = 0
    kids.forEach((k, i) => {
      if (left.length === 0 && (right.length === 0 || run + ext[i] / 2 <= total / 2)) {
        right.push(k)
        run += ext[i] + GAP_CROSS
      } else left.push(k)
    })

    const centerW = Math.max(folderMainSize(t.label), 140)
    const center: LayoutNode = {
      id: t.id, kind: 'center', base: { x: 0, y: -FOLDER_H / 2, w: centerW, h: FOLDER_H },
      label: t.label, node: t.node
    }
    out.nodes.push(center)
    out.minX = 0; out.maxX = centerW; out.minY = -FOLDER_H / 2; out.maxY = FOLDER_H / 2

    const colR = buildCols(depthSizes, 'h', 1, centerW + GAP_MAIN, 1)
    let cursor = 0
    for (const k of right) {
      const span = subtreeCross(k)
      cursor = placeNode(k, 'h', 1, 1, cursor - span / 2, colR, out, null) + GAP_CROSS
      const placed = out.nodes.find((n) => n.id === k.id)
      if (placed) out.edges.push({ id: `${center.id}->${placed.id}`, parentId: center.id, childId: placed.id, axis: 'h', dir: 1, childIsFolder: k.kind === 'folder' })
    }
    const colL = buildCols(depthSizes, 'h', -1, -GAP_MAIN, 1)
    cursor = 0
    for (const k of left) {
      const span = subtreeCross(k)
      cursor = placeNode(k, 'h', -1, 1, cursor - span / 2, colL, out, null) + GAP_CROSS
      const placed = out.nodes.find((n) => n.id === k.id)
      if (placed) out.edges.push({ id: `${center.id}->${placed.id}`, parentId: center.id, childId: placed.id, axis: 'h', dir: -1, childIsFolder: k.kind === 'folder' })
    }
    return out
  }

  if (m === 'arch') {
    const cols = buildCols(depthSizes, 'v', 1, 0, 0)
    placeNode(t, 'v', 1, 0, 0, cols, out, null)
    return out
  }

  const cols = buildCols(depthSizes, 'h', 1, 0, 0)
  placeNode(t, 'h', 1, 0, 0, cols, out, null)
  return out
}

/* ---- 顶层编排：每个一级文件夹一个中心主题 ---- */

interface RenderNode extends LayoutNode {
  x: number
  y: number
}

interface RenderEdge extends LayoutEdge {
  d: string
  mx: number
  my: number
}

const forest = computed(() => {
  const centers = lib.tree.map((n) => buildTreeNode(n))
  const eff = effectiveOffsets()

  // 先按模式布局每棵中心树，再平移堆叠
  const layouts = centers.map((t) => layoutCenter(t, mode.value))

  const nodes: RenderNode[] = []
  const edges: RenderEdge[] = []
  let originCross = 20
  let maxMain = 0
  const placeEdge = (e: LayoutEdge, dx: number, dy: number) => {
    const p = nodeById.get(e.parentId)
    const c = nodeById.get(e.childId)
    if (!p || !c) return
    const { d, mx, my } = edgePath(p, c, e.axis, e.dir)
    edges.push({ ...e, d, mx: mx + 0, my: my + 0 })
    void dx
    void dy
  }

  const nodeById = new Map<string, RenderNode>()

  if (mode.value === 'arch') {
    let xCursor = 20
    for (const lay of layouts) {
      const dx = xCursor - lay.minX
      const dy = 20 - lay.minY
      for (const n of lay.nodes) {
        const r = { ...n, x: n.base.x + dx + (eff[n.id]?.x ?? 0), y: n.base.y + dy + (eff[n.id]?.y ?? 0) }
        nodes.push(r)
        nodeById.set(n.id, r)
      }
      for (const e of lay.edges) placeEdge(e, 0, 0)
      xCursor = Math.max(xCursor, lay.maxX + dx) + 100
      maxMain = Math.max(maxMain, lay.maxY + dy)
    }
    originCross = maxMain + 60
  } else {
    for (const lay of layouts) {
      const dx = (mode.value === 'mind' ? 360 : 20) - lay.minX
      const dy = originCross - lay.minY
      for (const n of lay.nodes) {
        const r = { ...n, x: n.base.x + dx + (eff[n.id]?.x ?? 0), y: n.base.y + dy + (eff[n.id]?.y ?? 0) }
        nodes.push(r)
        nodeById.set(n.id, r)
      }
      for (const e of lay.edges) placeEdge(e, 0, 0)
      originCross = lay.maxY + dy + CENTER_GAP
      maxMain = Math.max(maxMain, lay.maxX + dx)
    }
  }

  // 未归类文档卡片：独立浮动，不连线
  let fx = 20
  let fy = originCross + 10
  for (const c of lib.looseCards) {
    if (fx + DOC_W > 1400) {
      fx = 20
      fy += DOC_H + GAP_CROSS
    }
    const id = `d:${c.meta.id}`
    nodes.push({
      id, kind: 'doc', base: { x: fx, y: fy, w: DOC_W, h: DOC_H }, label: c.meta.title, card: c,
      x: fx + (eff[id]?.x ?? 0), y: fy + (eff[id]?.y ?? 0)
    })
    fx += DOC_W + 24
  }

  // 收起：隐藏被收起文件夹的后代（位置不变）
  const hidden = hiddenSet(centers)
  const visNodes = nodes.filter((n) => !hidden.has(n.id))
  const visEdges = edges.filter((e) => !hidden.has(e.childId) && !hidden.has(e.parentId))

  let width = 800
  let height = originCross + DOC_H + 160
  for (const n of visNodes) {
    width = Math.max(width, n.x + n.base.w + 60)
    height = Math.max(height, n.y + n.base.h + 80)
  }
  return { nodes: visNodes, edges: visEdges, width, height, nodeById }
})

/** 连线在有效位置下即时计算 */
function edgePath(p: RenderNode, c: RenderNode, axis: 'h' | 'v', dir: 1 | -1): { d: string; mx: number; my: number } {
  if (axis === 'h') {
    const x1 = dir === 1 ? p.x + p.base.w : p.x
    const y1 = p.y + p.base.h / 2
    const x2 = dir === 1 ? c.x : c.x + c.base.w
    const y2 = c.y + c.base.h / 2
    const mid = (x1 + x2) / 2
    return { d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`, mx: mid, my: (y1 + y2) / 2 }
  }
  const x1 = p.x + p.base.w / 2
  const y1 = p.y + p.base.h
  const x2 = c.x + c.base.w / 2
  const y2 = c.y
  const mid = (y1 + y2) / 2
  return { d: `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`, mx: (x1 + x2) / 2, my: mid }
}

function hiddenSet(centers: TreeNode[]): Set<string> {
  const hidden = new Set<string>()
  const walk = (t: TreeNode, belowCollapsed: boolean): void => {
    if (belowCollapsed) hidden.add(t.id)
    const kidsCollapsed = belowCollapsed || collapsed.value.has(t.id)
    for (const c of t.children) {
      if (kidsCollapsed) hidden.add(c.id)
      walk(c, kidsCollapsed)
    }
  }
  for (const t of centers) {
    // 中心自身永远可见
    for (const c of t.children) {
      if (collapsed.value.has(t.id)) hidden.add(c.id)
      walk(c, collapsed.value.has(t.id))
    }
  }
  return hidden
}

function effectiveOffsets(): Record<string, { x: number; y: number }> {
  const eff: Record<string, { x: number; y: number }> = {}
  const walk = (t: TreeNode, px: number, py: number): void => {
    const own = offsets.value[t.id]
    const x = px + (own?.x ?? 0)
    const y = py + (own?.y ?? 0)
    eff[t.id] = { x, y }
    for (const c of t.children) walk(c, x, y)
  }
  for (const n of lib.tree) walk(buildTreeNode(n), 0, 0)
  for (const c of lib.looseCards) {
    const own = offsets.value[`d:${c.meta.id}`]
    eff[`d:${c.meta.id}`] = { x: own?.x ?? 0, y: own?.y ?? 0 }
  }
  return eff
}

/* ---- 折叠按钮 ---- */

function isCollapsed(id: string): boolean {
  return collapsed.value.has(id)
}

function toggleCollapse(id: string): void {
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
}

function hasChildren(id: string): boolean {
  const find = (list: FolderNode[]): FolderNode | null => {
    for (const n of list) {
      if (`f:${n.path}` === id) return n
      const hit = find(n.children)
      if (hit) return hit
    }
    return null
  }
  const node = find(lib.tree)
  return !!node && (node.children.length > 0 || node.docs.length > 0)
}

/* ---- 拖拽 ---- */

let dragCtx: { id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null
const swallowClick = ref(false)

function startDrag(id: string, ev: PointerEvent): void {
  if (ev.button !== 0) return
  const own = offsets.value[id] ?? { x: 0, y: 0 }
  dragCtx = { id, sx: ev.clientX, sy: ev.clientY, ox: own.x, oy: own.y, moved: false }
  window.addEventListener('pointermove', onDragMove)
  window.addEventListener('pointerup', onDragEnd)
}

function onDragMove(ev: PointerEvent): void {
  if (!dragCtx) return
  const dx = (ev.clientX - dragCtx.sx) / zoom.value
  const dy = (ev.clientY - dragCtx.sy) / zoom.value
  if (!dragCtx.moved && Math.hypot(dx, dy) < 4) return
  dragCtx.moved = true
  offsets.value = { ...offsets.value, [dragCtx.id]: { x: dragCtx.ox + dx, y: dragCtx.oy + dy } }
}

function onDragEnd(): void {
  if (dragCtx?.moved) {
    swallowClick.value = true
    setTimeout(() => (swallowClick.value = false), 50)
  }
  dragCtx = null
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
}

function onNodeDown(id: string, ev: PointerEvent): void {
  startDrag(id, ev)
}

function onDocClick(card: DocCardInfo): void {
  if (swallowClick.value) return
  emit('open-doc', card.meta)
}

function resetLayout(): void {
  offsets.value = {}
}

function toggleCollapseAll(v: boolean): void {
  if (!v) {
    collapsed.value = new Set()
    return
  }
  const all = new Set<string>()
  const walk = (n: FolderNode): void => {
    all.add(`f:${n.path}`)
    for (const c of n.children) walk(c)
  }
  for (const n of lib.tree) walk(n)
  collapsed.value = all
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', onDragEnd)
})

const hoverLink = ref('')

function folderStyle(n: RenderNode): Record<string, string> {
  return {
    left: `${n.x}px`,
    top: `${n.y}px`,
    width: `${n.base.w}px`,
    height: `${n.base.h}px`
  }
}
</script>

<template>
  <div class="lib-mind">
    <div class="mind-bar">
      <button
        v-for="m in ([['mind', '思维导图'], ['logic', '逻辑图'], ['arch', '架构图']] as [MindMode, string][])"
        :key="m[0]"
        class="view-btn"
        :class="{ active: mode === m[0] }"
        @click="mode = m[0]"
      >
        {{ m[1] }}
      </button>
      <span class="mind-sep" />
      <button
        class="view-btn"
        :class="{ active: folderWidthMode === 'card' }"
        @click="folderWidthMode = folderWidthMode === 'card' ? 'fit' : 'card'"
      >
        {{ folderWidthMode === 'card' ? '等宽卡片 开' : '等宽卡片 关' }}
      </button>
      <span class="mind-sep" />
      <button class="btn small" @click="toggleCollapseAll(false)">全部展开</button>
      <button class="btn small" @click="toggleCollapseAll(true)">全部收起</button>
      <button class="btn small" @click="resetLayout">复位拖动</button>
      <span class="mind-sep" />
      <button class="btn small" @click="zoom = Math.max(0.4, +(zoom - 0.15).toFixed(2))">－</button>
      <span class="mind-zoom-label">{{ Math.round(zoom * 100) }}%</span>
      <button class="btn small" @click="zoom = Math.min(1.6, +(zoom + 0.15).toFixed(2))">＋</button>
      <span class="mind-hint">拖动节点连带分支；悬停连线出现 ⊖ 收起该支；收起处点 ⊕ 展开</span>
    </div>

    <div class="mind-scroll">
      <div class="mind-canvas" :style="{ width: `${forest.width * zoom}px`, height: `${forest.height * zoom}px` }">
        <div class="mind-inner" :style="{ transform: `scale(${zoom})`, width: `${forest.width}px`, height: `${forest.height}px` }">
          <svg class="mind-links" :width="forest.width" :height="forest.height">
            <template v-for="e in forest.edges" :key="e.id">
              <path :d="e.d" class="mind-link" />
              <path
                v-if="e.childIsFolder"
                :d="e.d"
                class="mind-link-hit"
                @pointerenter="hoverLink = e.id"
                @pointerleave="hoverLink === e.id && (hoverLink = '')"
              />
            </template>
          </svg>

          <button
            v-for="e in forest.edges.filter((x) => x.childIsFolder)"
            v-show="hoverLink === e.id"
            :key="`btn-${e.id}`"
            class="mind-collapse"
            :style="{ left: `${e.mx - 11}px`, top: `${e.my - 11}px` }"
            @mouseenter="hoverLink = e.id"
            @click.stop="toggleCollapse(e.childId)"
          >
            ⊖
          </button>

          <template v-for="n in forest.nodes" :key="n.id">
            <div
              v-if="n.kind === 'doc' && n.card"
              class="mind-doc"
              :style="{ left: `${n.x}px`, top: `${n.y}px`, width: `${n.base.w}px` }"
              @pointerdown="onNodeDown(n.id, $event)"
            >
              <DocCardTile
                :card="n.card"
                @open="onDocClick(n.card!)"
                @detail="emit('detail-card', n.card!)"
                @rename="emit('rename-doc', n.card!.meta)"
                @copy="emit('copy-doc', n.card!.meta)"
                @remove="emit('remove-doc', n.card!.meta)"
              />
            </div>

            <div
              v-else
              class="mind-folder"
              :class="{ center: n.kind === 'center' }"
              :style="folderStyle(n)"
              @pointerdown="onNodeDown(n.id, $event)"
            >
              <span v-if="n.kind !== 'center'" class="mf-badge"><GlyphIcon name="folder" :size="14" /></span>
              <span class="mf-name" :title="n.label">{{ n.label }}</span>
              <button
                v-if="isCollapsed(n.id) && hasChildren(n.id)"
                class="mf-expand"
                title="展开该分支"
                @click.stop="toggleCollapse(n.id)"
              >
                ⊕
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lib-mind {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.mind-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--panel-soft);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}

.view-btn {
  border: 1px solid var(--border);
  background: var(--panel);
  padding: 3px 10px;
  font-size: 12px;
  border-radius: 6px;
  color: var(--ink-soft);
}

.view-btn.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.mind-sep {
  width: 1px;
  height: 18px;
  background: var(--border);
}

.mind-zoom-label {
  font-size: 12px;
  color: var(--muted);
  min-width: 38px;
  text-align: center;
}

.mind-hint {
  margin-left: auto;
  font-size: 12px;
  color: var(--muted);
}

.mind-scroll {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.mind-canvas {
  position: relative;
}

.mind-inner {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
}

.mind-links {
  position: absolute;
  inset: 0;
}

.mind-link {
  fill: none;
  stroke: var(--border-strong);
  stroke-width: 1.4;
  pointer-events: none;
}

.mind-link-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 14;
  cursor: pointer;
}

.mind-collapse {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border-strong);
  background: var(--panel);
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1;
  z-index: 5;
}

.mind-collapse:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.mind-doc {
  position: absolute;
}

.mind-folder {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--accent);
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  font-weight: 600;
  cursor: grab;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
}

.mind-folder:active {
  cursor: grabbing;
}

.mind-folder.center {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  border-radius: 999px;
  font-size: 14px;
  justify-content: center;
}

.mf-badge {
  flex-shrink: 0;
  display: grid;
  place-items: center;
}

.mf-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.mf-expand {
  margin-left: auto;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  line-height: 1;
}
</style>
