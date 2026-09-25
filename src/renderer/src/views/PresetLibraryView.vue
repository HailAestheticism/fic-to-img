<script setup lang="ts">
/**
 * 预设库：展柜式卡片浏览全部排版预设，点卡片进入预设编辑界面。
 * 卡片呈现背景 + 四级文字样例（H0/一级标题/二级标题/正文两段），无右上角菜单键。
 */
import { onMounted, ref } from 'vue'
import type { Preset } from '@shared/types'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import PresetCard from '../components/presets/PresetCard.vue'
import PresetEditorView from './PresetEditorView.vue'

const app = useAppStore()
const presets = ref<Preset[]>([])
const editing = ref<Preset | null>(null)

onMounted(() => void refresh())

async function refresh(): Promise<void> {
  presets.value = await api.presets.list()
}

function onSaved(p: Preset): void {
  const i = presets.value.findIndex((x) => x.id === p.id)
  if (i >= 0) presets.value[i] = p
}
</script>

<template>
  <div class="preset-lib">
    <template v-if="editing">
      <PresetEditorView :key="editing.id" :preset="editing" @close="editing = null" @saved="onSaved" />
    </template>
    <template v-else>
      <header class="lib-header">
        <div class="brand">
          <h1>预设库</h1>
        </div>
        <div class="lib-tools">
          <span v-if="presets.length" class="muted">{{ presets.length }} 套预设</span>
          <button class="btn" @click="app.closePresets()">← 返回</button>
        </div>
      </header>
      <div v-if="presets.length" class="preset-grid">
        <PresetCard v-for="p in presets" :key="p.id" :preset="p" @open="editing = p" />
      </div>
      <p v-else class="empty">
        暂无预设：可在写作模式「预设 → 存为预设」把当前版面保存成预设。
      </p>
    </template>
  </div>
</template>

<style scoped>
.preset-lib {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
}

.preset-grid {
  flex: 1;
  overflow-y: auto;
  /* 预设卡要容下 H0 + 一级/二级标题 + 两段正文，比文档卡高 */
  --tile-h: 266px;
  padding: 18px 24px 40px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 18px;
  align-content: start;
}
</style>
