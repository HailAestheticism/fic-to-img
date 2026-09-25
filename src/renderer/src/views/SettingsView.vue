<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useLibraryStore } from '../stores/library'
import { api } from '../api'
import type { CustomCanvas } from '@shared/types'
import {
  CANVAS_GROUPS,
  CANVAS_PRESETS,
  customToPreset,
  resolveDefaultCanvas,
  type CanvasPreset
} from '@shared/paper'

const app = useAppStore()
const lib = useLibraryStore()

const sidebarSide = ref<'left' | 'right'>('left')

onMounted(async () => {
  const s = await api.settings.get()
  sidebarSide.value = s.sidebarSide ?? 'left'
  customCanvases.value = s.customCanvases ?? []
  defaultCanvas.value = resolveDefaultCanvas(s.defaultCanvas, s.customCanvases).key
})

function saveSidebarSide(v: 'left' | 'right'): void {
  sidebarSide.value = v
  void api.settings.set({ sidebarSide: v })
}

// ---------- 新建文档默认画布 ----------

const customCanvases = ref<CustomCanvas[]>([])
const defaultCanvas = ref('')

const presetGroups = CANVAS_GROUPS.map((g) => ({
  ...g,
  presets: CANVAS_PRESETS.filter((p) => p.group === g.id)
})).filter((g) => g.presets.length > 0)

function saveDefaultCanvas(key: string): void {
  defaultCanvas.value = key
  void api.settings.set({ defaultCanvas: key })
}

function sizeTitle(p: CanvasPreset): string {
  return p.infiniteHeight
    ? `${p.label}：宽 ${Math.round(p.widthMm)} mm × 无限`
    : `${p.label}：${Math.round(p.widthMm)}×${Math.round(p.heightMm ?? 0)} mm`
}

const stats = computed(() => {
  const chars = lib.cards.reduce((s, c) => s + c.charCount, 0)
  const last = lib.cards.reduce((m, c) => Math.max(m, c.meta.updatedAt), 0)
  return { docs: lib.cards.length, chars, folders: lib.foldersList.length, last }
})

const VIEW_OPTIONS: { key: 'browse' | 'tree' | 'mind'; label: string }[] = [
  { key: 'browse', label: '展柜' },
  { key: 'tree', label: '目录树' },
  { key: 'mind', label: '思维导图' }
]

function fmtFull(ts: number): string {
  if (!ts) return '—'
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="settings-view">
    <header class="lib-header">
      <div class="brand">
        <h1>设置</h1>
      </div>
      <div class="lib-tools">
        <button class="btn" @click="app.toLibrary()">← 返回文档库</button>
      </div>
    </header>
    <div class="settings-body">
      <section class="settings-card">
        <h3>文档库统计</h3>
        <dl class="stat-list">
          <dt>文档总数</dt>
          <dd>{{ stats.docs }} 篇</dd>
          <dt>总文档字数</dt>
          <dd>{{ stats.chars.toLocaleString() }} 字</dd>
          <dt>文件夹数</dt>
          <dd>{{ stats.folders }} 个</dd>
          <dt>最近编辑</dt>
          <dd>{{ fmtFull(stats.last) }}</dd>
        </dl>
      </section>
      <section class="settings-card">
        <h3>启动软件时默认显示</h3>
        <label v-for="v in VIEW_OPTIONS" :key="v.key" class="radio">
          <input v-model="lib.startView" type="radio" :value="v.key" />
          {{ v.label }}
        </label>
        <p class="dlg-tip">下次启动生效；选择后立即用于当前会话可点「应用并切换」。</p>
        <button class="btn primary" @click="app.toLibrary(); lib.view = lib.startView">应用并切换</button>
      </section>
      <section class="settings-card">
        <h3>章节侧边栏位置</h3>
        <label class="radio">
          <input v-model="sidebarSide" type="radio" value="left" @change="saveSidebarSide('left')" />
          左侧（默认）
        </label>
        <label class="radio">
          <input v-model="sidebarSide" type="radio" value="right" @change="saveSidebarSide('right')" />
          右侧
        </label>
        <p class="dlg-tip">写作模式章节导航的停靠位置，回到工作台后立即生效。</p>
      </section>
      <section class="settings-card">
        <h3>新建文档默认画布</h3>
        <div v-for="g in presetGroups" :key="g.id" class="canvas-group">
          <span class="canvas-group-label">{{ g.label }}</span>
          <div class="canvas-chips">
            <button
              v-for="p in g.presets"
              :key="p.key"
              class="btn small canvas-chip"
              :class="{ active: defaultCanvas === p.key }"
              :title="sizeTitle(p)"
              @click="saveDefaultCanvas(p.key)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>
        <div v-if="customCanvases.length" class="canvas-group">
          <span class="canvas-group-label">自定义</span>
          <div class="canvas-chips">
            <button
              v-for="c in customCanvases"
              :key="c.id"
              class="btn small canvas-chip"
              :class="{ active: defaultCanvas === c.id }"
              :title="sizeTitle(customToPreset(c))"
              @click="saveDefaultCanvas(c.id)"
            >
              {{ c.label }}
            </button>
          </div>
        </div>
        <p class="dlg-tip">
          点选即生效，影响文档库「＋ 新建文档」与导入本地文件新建的文档；已有文档的画布不受影响。
        </p>
        <p v-if="!customCanvases.length" class="dlg-tip">
          暂无自定义尺寸：可在写作模式「页面设置 → 画布大小」把当前尺寸存入自定义。
        </p>
      </section>
      <section class="settings-card">
        <h3>移动端同步</h3>
        <p class="dlg-tip">手机主屏幕 App 离线写作，回到局域网后与电脑双向同步。</p>
        <button class="btn primary" @click="app.openMobilePanel()">移动端同步…</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
}

.settings-card {
  width: 100%;
  max-width: 640px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.settings-card h3 {
  font-size: 14px;
  margin-bottom: 4px;
}

.stat-list {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 18px;
  margin: 0;
  font-size: 13px;
  width: 100%;
}

.stat-list dt {
  color: var(--muted);
}

.stat-list dd {
  margin: 0;
  font-weight: 600;
}

.radio {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.dlg-tip {
  font-size: 12px;
  color: var(--muted);
  margin: 2px 0 6px;
}

.canvas-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.canvas-group-label {
  font-size: 12px;
  color: var(--muted);
}

.canvas-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.canvas-chip.active {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
</style>
