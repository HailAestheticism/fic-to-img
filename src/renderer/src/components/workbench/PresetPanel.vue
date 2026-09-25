<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ActivePageInfo, BackgroundSpec, Preset, PresetKind } from '@shared/types'
import { api } from '../../api'
import { useDocStore } from '../../stores/doc'
import { stripManualFormatting } from '../../presets/preset-service'
import PresetSaveDialog from './PresetSaveDialog.vue'

const props = defineProps<{
  active: ActivePageInfo | null
  /** 折叠卡片包裹时标题由卡片渲染 */
  hideHead?: boolean
}>()
const emit = defineEmits<{ (e: 'applied', name: string): void }>()

const doc = useDocStore()

const presets = ref<Preset[]>([])
const applyScope = ref<'doc' | 'chapter' | 'page'>('doc')
const forceOverwrite = ref(false)
const showSave = ref(false)

const KIND_LABELS: Record<PresetKind, string> = {
  pageSetup: '页面设置',
  typography: '文本样式',
  background: '背景',
  combined: '系统预设'
}

onMounted(() => void refresh())

async function refresh(): Promise<void> {
  presets.value = await api.presets.list()
}

function bgForScope(): BackgroundSpec | null {
  const bgs = doc.layout!.backgrounds
  const a = props.active
  if (applyScope.value === 'chapter' && a) return bgs.chapter[a.chapterId] ?? null
  if (applyScope.value === 'page' && a) return bgs.page[`${a.chapterId}:${a.pageIndex}`] ?? null
  return bgs.global
}

async function apply(p: Preset, scope: 'doc' | 'chapter' | 'page' = 'doc'): Promise<void> {
  applyScope.value = scope
  const layout = doc.layout
  if (!layout) return

  if (p.kind === 'pageSetup' || p.kind === 'combined') {
    if (p.data.pageSetup) doc.patchLayout({ pageSetup: p.data.pageSetup }, 'preset')
  }

  if ((p.kind === 'typography' || p.kind === 'combined') && p.data.typography) {
    if (p.kind === 'typography' && applyScope.value === 'chapter' && props.active) {
      const chapterId = props.active.chapterId
      const chapters = { ...layout.chapters }
      chapters[chapterId] = {
        ...chapters[chapterId],
        styleOverrides: {
          ...chapters[chapterId]?.styleOverrides,
          typography: p.data.typography
        }
      }
      doc.patchLayout({ chapters }, 'preset')
    } else {
      doc.patchLayout({ typography: p.data.typography }, 'preset')
    }
    if (forceOverwrite.value && doc.content) {
      doc.patchContent(
        stripManualFormatting(doc.content, {
          chapterId: p.kind === 'typography' && applyScope.value === 'chapter' ? props.active?.chapterId : undefined
        }),
        // 与同一批布局改动同名，整套预设合为一步撤销
        'preset'
      )
    }
  }

  if (p.kind === 'background' && p.data) {
    const spec = p.data.background ?? null
    const bgs = {
      global: layout.backgrounds.global,
      chapter: { ...layout.backgrounds.chapter },
      page: { ...layout.backgrounds.page }
    }
    if (applyScope.value === 'chapter' && props.active) {
      if (spec) bgs.chapter[props.active.chapterId] = spec
      else delete bgs.chapter[props.active.chapterId]
    } else if (applyScope.value === 'page' && props.active) {
      const key = `${props.active.chapterId}:${props.active.pageIndex}`
      if (spec) bgs.page[key] = spec
      else delete bgs.page[key]
    } else {
      bgs.global = spec
    }
    doc.patchLayout({ backgrounds: bgs }, 'preset')
  }

  if (p.kind === 'combined' && p.data.background !== undefined) {
    doc.patchLayout({ backgrounds: { ...layout.backgrounds, global: p.data.background } }, 'preset')
  }

  emit('applied', p.name)
}

async function removePreset(p: Preset): Promise<void> {
  await api.presets.remove(p.id)
  await refresh()
}

async function importPresets(): Promise<void> {
  const paths = await api.dialog.openFile({
    title: '导入预设',
    filters: [{ name: '预设 JSON', extensions: ['json'] }],
    multi: true
  })
  if (!paths.length) return
  await api.presets.importFromPaths(paths)
  await refresh()
}

async function exportPresets(): Promise<void> {
  const path = await api.dialog.saveFile({
    title: '导出预设',
    defaultName: 'presets.json',
    filters: [{ name: '预设 JSON', extensions: ['json'] }]
  })
  if (!path) return
  await api.presets.exportToPath(path, presets.value.map((p) => p.id))
}

/** 系统预设 = 整套主题（kind=combined），点一下即套用全文 */
const systemPresets = computed(() => presets.value.filter((p) => p.kind === 'combined'))
const localPresets = computed(() => presets.value.filter((p) => p.kind !== 'combined'))

const grouped = computed(() => {
  const map = new Map<PresetKind, Preset[]>()
  for (const p of localPresets.value) {
    if (!map.has(p.kind)) map.set(p.kind, [])
    map.get(p.kind)!.push(p)
  }
  return [...map.entries()]
})

function scopeOptions(p: Preset): { value: 'doc' | 'chapter' | 'page'; label: string; disabled: boolean }[] {
  return [
    { value: 'doc', label: p.kind === 'background' ? '全局' : '全文', disabled: false },
    {
      value: 'chapter',
      label: '当前章',
      disabled: !props.active || p.kind === 'pageSetup' || p.kind === 'combined'
    },
    {
      value: 'page',
      label: '当前页',
      disabled: !props.active || p.kind !== 'background'
    }
  ]
}

function setScope(p: Preset, v: string): void {
  applyScope.value = v as 'doc' | 'chapter' | 'page'
}
</script>

<template>
  <section class="preset-panel">
    <header v-if="!props.hideHead" class="sp-head">预设</header>

    <div class="sp-group">
      <button class="btn small" @click="showSave = true">保存当前设置为预设</button>
    </div>

    <div v-if="systemPresets.length" class="sp-group">
      <p class="sp-label">系统预设</p>
      <div class="pr-sys">
        <button v-for="p in systemPresets" :key="p.id" class="btn pr-sys-btn" @click="apply(p, 'doc')">
          {{ p.name }}
        </button>
      </div>
    </div>

    <div class="sp-group">
      <p class="sp-label">本地预设</p>
      <div v-if="localPresets.length" class="pr-list">
        <div v-for="[k, list] in grouped" :key="k" class="pr-group">
          <p class="sp-sublabel">{{ KIND_LABELS[k] }}</p>
          <div v-for="p in list" :key="p.id" class="pr-item">
            <span class="pr-name" :title="p.name">{{ p.name }}</span>
            <select
              class="input pr-scope"
              :value="applyScope"
              title="套用范围"
              @change="setScope(p, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="o in scopeOptions(p)" :key="o.value" :value="o.value" :disabled="o.disabled">
                {{ o.label }}
              </option>
            </select>
            <button class="btn small primary" @click="apply(p, applyScope)">套用</button>
            <button class="btn small" title="删除预设" @click="removePreset(p)">删</button>
          </div>
        </div>
      </div>
      <p v-else class="muted pr-empty">暂无本地预设</p>

      <label v-if="localPresets.some((p) => p.kind === 'typography')" class="check pr-force">
        <input v-model="forceOverwrite" type="checkbox" />
        套用文本样式时清除手动格式（强制覆盖）
      </label>

      <div class="fl-btns">
        <button class="btn small" @click="importPresets">从本地导入</button>
        <button class="btn small" :disabled="!presets.length" @click="exportPresets">导出到本地</button>
      </div>
    </div>

    <PresetSaveDialog v-if="showSave" @close="showSave = false" @saved="refresh" />
  </section>
</template>

<style scoped>
.preset-panel {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sp-head {
  font-size: 13px;
  font-weight: 600;
}

.sp-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sp-label {
  font-size: 12px;
  color: var(--muted);
}

.sp-sublabel {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
}

.pr-sys {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pr-sys-btn {
  flex: 1;
  min-width: 96px;
  padding: 8px 10px;
  font-size: 13px;
}

.fl-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pr-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pr-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pr-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.pr-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}

.pr-scope {
  width: 72px;
  flex-shrink: 0;
  padding: 3px 4px;
  font-size: 11px;
}

.pr-force {
  font-size: 12px;
  color: var(--ink-soft);
}

.pr-empty {
  font-size: 12px;
}
</style>
