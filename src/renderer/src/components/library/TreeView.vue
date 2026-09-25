<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { DocCardInfo, DocMeta } from '@shared/types'
import { useLibraryStore } from '../../stores/library'
import type { FolderNode } from '../../stores/library'
import DocCardTile from './DocCardTile.vue'
import DocDetails from './DocDetails.vue'
import GlyphIcon from '../common/GlyphIcon.vue'

const lib = useLibraryStore()

const emit = defineEmits<{
  (e: 'open-doc', doc: DocMeta): void
  (e: 'rename-doc', doc: DocMeta): void
  (e: 'copy-doc', doc: DocMeta): void
  (e: 'remove-doc', doc: DocMeta): void
}>()

type Selection = { kind: 'doc'; card: DocCardInfo } | { kind: 'folder'; node: FolderNode } | null

const selected = ref<Selection>(null)

/** null = 尚未手动展开过任何文件夹（启动默认全部收起） */
const expanded = ref<Set<string> | null>(null)

function isExpanded(path: string): boolean {
  return expanded.value?.has(path) ?? false
}

function toggle(path: string): void {
  if (!expanded.value) expanded.value = new Set()
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

interface Row {
  key: string
  depth: number
  kind: 'folder' | 'doc'
  node?: FolderNode
  card?: DocCardInfo
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (nodes: FolderNode[], depth: number): void => {
    for (const n of nodes) {
      out.push({ key: `f:${n.path}`, depth, kind: 'folder', node: n })
      if (!isExpanded(n.path)) continue
      walk(n.children, depth + 1)
      for (const d of n.docs) {
        const card = lib.cardById[d.id]
        if (card) out.push({ key: `d:${d.id}`, depth: depth + 1, kind: 'doc', card })
      }
    }
  }
  walk(lib.tree, 0)
  for (const c of lib.looseCards) out.push({ key: `d:${c.meta.id}`, depth: 0, kind: 'doc', card: c })
  return out
})

function selectFolder(n: FolderNode): void {
  selected.value = { kind: 'folder', node: n }
}

function isFolderSelected(path: string): boolean {
  return selected.value?.kind === 'folder' && selected.value.node.path === path
}

function selectDoc(c: DocCardInfo): void {
  selected.value = { kind: 'doc', card: c }
}

function fmtFull(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtDate(ts: number): string {
  return fmtFull(ts).slice(0, 10)
}

/* ---- 分栏拖动 ---- */
const wrapEl = ref<HTMLElement | null>(null)
const leftPct = ref(55)
let dragging = false

function onSplitDown(ev: PointerEvent): void {
  dragging = true
  ev.preventDefault()
  window.addEventListener('pointermove', onSplitMove)
  window.addEventListener('pointerup', onSplitUp)
}

function onSplitMove(ev: PointerEvent): void {
  if (!dragging || !wrapEl.value) return
  const rect = wrapEl.value.getBoundingClientRect()
  const pct = ((ev.clientX - rect.left) / rect.width) * 100
  leftPct.value = Math.min(80, Math.max(30, pct))
}

function onSplitUp(): void {
  dragging = false
  window.removeEventListener('pointermove', onSplitMove)
  window.removeEventListener('pointerup', onSplitUp)
}

onBeforeUnmount(() => onSplitUp())

const folderTotals = computed(() => {
  const map: Record<string, { chars: number; docs: number }> = {}
  const walk = (n: FolderNode): { chars: number; docs: number } => {
    let chars = 0
    let docs = n.docs.length
    for (const d of n.docs) chars += lib.cardById[d.id]?.charCount ?? 0
    for (const c of n.children) {
      const t = walk(c)
      chars += t.chars
      docs += t.docs
    }
    map[n.path] = { chars, docs }
    return { chars, docs }
  }
  for (const n of lib.tree) walk(n)
  return map
})
</script>

<template>
  <div ref="wrapEl" class="tree-view">
    <div class="tv-left" @click="selected = null">
      <div class="tv-rows">
        <template v-for="r in rows" :key="r.key">
          <div
            v-if="r.kind === 'folder' && r.node"
            class="tv-folder-row"
            :class="{ active: isFolderSelected(r.node.path) }"
            :style="{ marginLeft: `${r.depth * 22}px` }"
            @click.stop="selectFolder(r.node)"
          >
            <button class="tv-caret" @click.stop="toggle(r.node.path)">
              {{ isExpanded(r.node.path) ? '▾' : '▸' }}
            </button>
            <span class="tv-badge"><GlyphIcon name="folder" :size="14" /></span>
            <span class="tv-name" :title="r.node.name">{{ r.node.name }}</span>
            <span class="tv-date">{{ fmtDate(r.node.updatedAt) }}</span>
          </div>
          <div
            v-else-if="r.card"
            class="tv-doc-row"
            :style="{ marginLeft: `${r.depth * 22}px` }"
            @click.stop
          >
            <DocCardTile
              :card="r.card"
              click-mode="detail"
              @open="emit('open-doc', r.card!.meta)"
              @detail="selectDoc(r.card!)"
              @dblclick="emit('open-doc', r.card!.meta)"
              @rename="emit('rename-doc', r.card!.meta)"
              @copy="emit('copy-doc', r.card!.meta)"
              @remove="emit('remove-doc', r.card!.meta)"
            />
          </div>
        </template>
        <p v-if="!rows.length" class="tv-empty muted">
          {{ lib.loading ? '加载中…' : '没有匹配的文档' }}
        </p>
      </div>
    </div>

    <div class="tv-splitter" @pointerdown="onSplitDown" />

    <aside class="tv-detail" @click.stop>
      <div v-if="selected && selected.kind === 'doc'" class="tv-detail-inner">
        <DocDetails :card="selected.card" />
        <button class="btn primary tv-open" @click="emit('open-doc', selected.card.meta)">进入编辑</button>
      </div>
      <div v-else-if="selected" class="tv-detail-inner">
        <h4 class="dd-title">{{ selected.node.name }}</h4>
        <dl class="fd-list">
          <dt>路径</dt><dd>文档库 / {{ selected.node.path.split('/').join(' / ') }}</dd>
          <dt>建立时间</dt><dd>{{ fmtFull(selected.node.createdAt) }}</dd>
          <dt>最后编辑</dt><dd>{{ fmtFull(selected.node.updatedAt) }}</dd>
          <dt>包含文档</dt><dd>{{ folderTotals[selected.node.path]?.docs ?? 0 }} 篇</dd>
          <dt>总字数</dt><dd>{{ (folderTotals[selected.node.path]?.chars ?? 0).toLocaleString() }} 字</dd>
        </dl>
      </div>
      <p v-else class="tv-detail-empty">未选中文件</p>
    </aside>
  </div>
</template>

<style scoped>
.tree-view {
  flex: 1;
  min-height: 0;
  display: flex;
}

.tv-left {
  flex: 0 0 auto;
  width: v-bind(leftPct + '%');
  min-width: 0;
  overflow: auto;
  background: var(--panel);
  padding: 12px 16px 40px;
}

.tv-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: max-content;
}

/* 可点击宽度与文档卡片一致 */
.tv-folder-row {
  width: 320px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  min-width: 0;
}

.tv-folder-row:hover {
  background: var(--panel-soft);
}

.tv-folder-row.active {
  background: var(--accent-soft);
}

.tv-caret {
  border: none;
  background: transparent;
  width: 16px;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 11px;
  padding: 0;
}

.tv-badge {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1.5px solid var(--border-strong);
  border-radius: 50%;
  background: var(--bg);
  color: var(--ink-soft);
}

.tv-name {
  font-weight: 600;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tv-date {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--muted);
  font-size: 11px;
}

.tv-doc-row {
  width: 320px;
}

.tv-empty {
  padding: 16px 4px;
  font-size: 13px;
}

.tv-splitter {
  flex: 0 0 6px;
  cursor: col-resize;
  background: var(--border);
  transition: background 0.15s;
}

.tv-splitter:hover {
  background: var(--accent);
}

.tv-detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: var(--panel-soft);
  padding: 16px 20px 40px;
}

.tv-detail-empty {
  margin-top: 40px;
  text-align: center;
  font-size: 14px;
  color: color-mix(in srgb, var(--panel-soft), #000 9%);
}

.tv-detail-inner {
  max-width: 420px;
}

.tv-open {
  margin-top: 16px;
}

.dd-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
}

.fd-list {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 4px 10px;
  font-size: 13px;
}

.fd-list dt {
  color: var(--muted);
  font-size: 12px;
}
</style>
