<script setup lang="ts">
/**
 * 预设编辑：左侧画布用固定测试文本按预设实时排版，右侧样式侧栏按预设类型分段编辑。
 * 改动防抖自动落库（api.presets.save），无手动保存按钮。
 */
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import type { BackgroundSpec, DocLayout, PageSetup, Preset, Typography } from '@shared/types'
import { findPreset } from '@shared/paper'
import { api } from '../api'
import PagedView from '../pager/PagedView.vue'
import CollapseCard from '../components/common/CollapseCard.vue'
import PageSetupPanel from '../components/workbench/PageSetupPanel.vue'
import LayerPanel from '../components/workbench/LayerPanel.vue'
import TypographyFields from '../components/presets/TypographyFields.vue'
import {
  KIND_LABELS,
  layoutFromPreset,
  presetSampleContent,
  sanitizeTypography,
  sectionsOf,
  type PresetSection
} from '../presets/preset-view'

const props = defineProps<{ preset: Preset }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', preset: Preset): void }>()

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

const working = ref<Preset>(clone(props.preset))
const sections = computed(() => sectionsOf(working.value.kind))
const live = reactive<DocLayout>(layoutFromPreset(working.value))
/** 画布首块大标题就是预设名：改名即改画布标题，与卡片展示同源 */
const sample = computed(() => presetSampleContent(working.value.name || '文档标题（大标题）'))

const open = reactive<Record<PresetSection, boolean>>({
  pageSetup: false,
  typography: false,
  background: false
})

function has(s: PresetSection): boolean {
  return sections.value.includes(s)
}

// ---------- 侧栏摘要 ----------

const canvasHint = computed(() => {
  const ps = live.pageSetup
  const preset = findPreset(ps.widthMm, ps.heightMm, ps.infiniteHeight === true)
  if (preset) return preset.label
  const h = ps.infiniteHeight ? '无限' : `${Math.round(ps.heightMm ?? 0)}`
  return `${Math.round(ps.widthMm)}×${h}mm`
})

const typoHint = computed(() => `${live.typography.bodyFont} ${live.typography.bodySize}px`)

const bgHint = computed(() => {
  const b = live.backgrounds.global
  if (!b) return '无背景'
  return b.kind === 'color' ? '纯色' : b.kind === 'gradient' ? '渐变' : b.kind === 'texture' ? '纹理' : '图片'
})

// ---------- 样式改动写回实时版面 ----------

function onPageSetup(ps: PageSetup): void {
  Object.assign(live.pageSetup, clone(ps))
}

function onPaper(payload: { pageSetup: PageSetup; typography: Typography }): void {
  Object.assign(live.pageSetup, clone(payload.pageSetup))
  Object.assign(live.typography, clone(payload.typography))
}

function onBg(spec: BackgroundSpec | null): void {
  live.backgrounds.global = spec ? clone(spec) : null
}

// ---------- 自动保存 ----------

type Status = 'saved' | 'dirty' | 'saving'
const status = ref<Status>('saved')
const savedAt = ref(0)
let timer: ReturnType<typeof setTimeout> | null = null

function markDirty(): void {
  status.value = 'dirty'
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void save()
  }, 700)
}

function buildPreset(): Preset {
  const data: Preset['data'] = clone(working.value.data)
  if (has('pageSetup')) data.pageSetup = clone(live.pageSetup)
  if (has('typography')) data.typography = sanitizeTypography(clone(live.typography))
  if (has('background')) data.background = clone(live.backgrounds.global ?? null)
  return { ...clone(working.value), data }
}

async function save(): Promise<void> {
  const payload = buildPreset()
  status.value = 'saving'
  try {
    await api.presets.save(payload)
    working.value = payload
    status.value = 'saved'
    savedAt.value = Date.now()
    emit('saved', payload)
  } catch {
    status.value = 'dirty'
  }
}

watch(live, markDirty, { deep: true })
watch(() => working.value.name, markDirty)

onBeforeUnmount(() => {
  if (timer) {
    clearTimeout(timer)
    timer = null
    void save()
  }
})

const statusText = computed(() => {
  if (status.value === 'dirty' || status.value === 'saving') return '未保存…'
  if (!savedAt.value) return '改动即自动保存'
  const d = new Date(savedAt.value)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `已保存 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
})
</script>

<template>
  <div class="preset-editor">
    <header class="lib-header">
      <div class="brand">
        <button class="btn" @click="emit('close')">← 返回预设库</button>
        <h1>{{ working.name || '未命名预设' }}</h1>
        <span class="pe-kind">{{ KIND_LABELS[working.kind] }}</span>
      </div>
      <div class="lib-tools">
        <label class="pe-name" title="预设名称；画布首块大标题与卡片标题同步显示它">
          <span>名称</span>
          <input v-model="working.name" class="input" placeholder="预设名称" />
        </label>
        <span class="muted pe-status">{{ statusText }}</span>
      </div>
    </header>
    <main class="mode-split">
      <PagedView :content="sample" :layout="live" :doc-title="working.name" />
      <aside class="layout-panel">
        <CollapseCard v-if="has('pageSetup')" v-model:open="open.pageSetup" title="页面设置" :hint="canvasHint">
          <PageSetupPanel
            hide-head
            :page-setup="live.pageSetup"
            :typography="live.typography"
            @update="onPageSetup"
            @update-paper="onPaper"
          />
        </CollapseCard>
        <CollapseCard v-if="has('typography')" v-model:open="open.typography" title="文本样式" :hint="typoHint">
          <TypographyFields :typo="live.typography" />
        </CollapseCard>
        <CollapseCard v-if="has('background')" v-model:open="open.background" title="背景" :hint="bgHint">
          <LayerPanel
            bg-only
            :doc-id="''"
            layer="bg"
            :active="null"
            :has-selection="false"
            :backgrounds="live.backgrounds"
            @bg="onBg"
          />
        </CollapseCard>
        <p v-if="!sections.length" class="pe-note">该预设类型暂无可编辑样式。</p>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.preset-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.pe-kind {
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 8px;
}

.pe-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-soft);
}

.pe-name .input {
  width: 190px;
}

.pe-status {
  font-size: 11px;
  white-space: nowrap;
}

.pe-note {
  padding: 14px;
  font-size: 12px;
  color: var(--muted);
}
</style>
