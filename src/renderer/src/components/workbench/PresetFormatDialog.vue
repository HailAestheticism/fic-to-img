<script setup lang="ts">
/**
 * 预设格式：一站编辑文档默认排版（写入当前文档 typography），
 * 并可命名保存为跨文档预设（api.presets，kind=typography）。
 */
import { onMounted, reactive, ref } from 'vue'
import type { Preset, Typography } from '@shared/types'
import Modal from '../common/Modal.vue'
import TypographyFields from '../presets/TypographyFields.vue'
import { api } from '../../api'
import { genId } from '../../editor/id'
import { sanitizeTypography } from '../../presets/preset-view'
import { useDocStore } from '../../stores/doc'

const emit = defineEmits<{ (e: 'close'): void }>()
const doc = useDocStore()

const form = reactive<Typography>(
  JSON.parse(JSON.stringify(doc.layout?.typography ?? {})) as Typography
)

function apply(): void {
  doc.patchLayout({ typography: sanitizeTypography(form) }, 'preset-format')
}

const presets = ref<Preset[]>([])
const presetName = ref('')
const saveError = ref('')

async function refresh(): Promise<void> {
  presets.value = (await api.presets.list()).filter((p) => p.kind === 'typography')
}

onMounted(() => void refresh())

async function savePreset(): Promise<void> {
  if (!presetName.value.trim()) {
    saveError.value = '请先为预设命名'
    return
  }
  saveError.value = ''
  await api.presets.save({
    id: genId(),
    name: presetName.value.trim(),
    kind: 'typography',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: { typography: JSON.parse(JSON.stringify(form)) }
  })
  presetName.value = ''
  await refresh()
}

async function applyPreset(p: Preset): Promise<void> {
  if (!p.data.typography) return
  Object.assign(form, JSON.parse(JSON.stringify(p.data.typography)))
  apply()
}

async function removePreset(p: Preset): Promise<void> {
  await api.presets.remove(p.id)
  await refresh()
}
</script>

<template>
  <Modal title="预设格式（文档默认排版）" wide @close="emit('close')">
    <div class="pf-grid">
      <TypographyFields :typo="form" />

      <section class="pf-sec">
        <h4>跨文档预设</h4>
        <div class="pf-field">
          <span>命名</span>
          <input v-model="presetName" class="input" placeholder="预设名称（必填）" />
        </div>
        <p v-if="saveError" class="pf-error">{{ saveError }}</p>
        <button class="btn small" @click="savePreset">将上方设置存为预设</button>
        <div v-if="presets.length" class="pf-list">
          <div v-for="p in presets" :key="p.id" class="pf-item">
            <span class="pf-name" :title="p.name">{{ p.name }}</span>
            <button class="btn small primary" @click="applyPreset(p)">套用</button>
            <button class="btn small" title="删除预设" @click="removePreset(p)">删</button>
          </div>
        </div>
        <p v-else class="pf-empty">暂无文本样式预设</p>
      </section>
    </div>

    <template #footer>
      <span class="pf-hint">应用后将作为当前文档的默认格式</span>
      <button class="btn" @click="emit('close')">关闭</button>
      <button class="btn primary" @click="apply(); emit('close')">应用到本文档</button>
    </template>
  </Modal>
</template>

<style>
.pf-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 16px;
}

.pf-sec h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--ink);
}

.pf-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pf-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pf-field > span {
  width: 64px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ink-soft);
}

.pf-field .input {
  flex: 1;
  min-width: 0;
}

.pf-field .input.color {
  height: 26px;
  padding: 2px;
}

.pf-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 180px;
  overflow-y: auto;
}

.pf-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pf-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
}

.pf-empty {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
}

.pf-error {
  color: var(--danger, #b3402f);
  font-size: 12px;
  margin: 0;
}

.pf-hint {
  flex: 1;
  color: var(--muted);
  font-size: 12px;
}
</style>
