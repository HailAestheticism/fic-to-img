<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { DocMeta } from '@shared/types'
import { api } from '../../api'
import { useAppStore } from '../../stores/app'
import Modal from '../common/Modal.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const app = useAppStore()

const docs = ref<DocMeta[]>([])
const scope = ref<'current' | 'pick' | 'all'>('current')
const pickId = ref('')
const busy = ref(false)
const result = ref<{ count: number; online: boolean } | null>(null)

onMounted(async () => {
  docs.value = (await api.docs.list()).sort((a, b) => b.updatedAt - a.updatedAt)
  if (app.currentDocId) {
    scope.value = 'current'
  } else {
    scope.value = 'pick'
    pickId.value = docs.value[0]?.id ?? ''
  }
})

function confirmLabel(): string {
  if (scope.value === 'all') return `同步全部 ${docs.value.length} 篇`
  if (scope.value === 'current') return '同步当前打开文档'
  return '同步所选文档'
}

async function confirm(): Promise<void> {
  if (busy.value) return
  let ids: string[] = []
  if (scope.value === 'all') ids = docs.value.map((d) => d.id)
  else if (scope.value === 'current') ids = [app.currentDocId]
  else if (pickId.value) ids = [pickId.value]
  if (!ids.length) return
  busy.value = true
  try {
    result.value = await api.mobile.syncToPhone(ids)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <Modal title="同步文档到手机" @close="emit('close')">
    <template v-if="!result">
      <p class="sp-tip">同步为单向覆盖：手机上这些文档会被电脑端的「大标题 + 正文」纯文本替换，电脑端排版（标题层级、列表、图片等）不会在手机上呈现，也不会从手机还原。</p>

      <label class="sp-opt" v-if="app.currentDocId">
        <input v-model="scope" type="radio" value="current" />
        <span>当前打开文档</span>
      </label>
      <label class="sp-opt">
        <input v-model="scope" type="radio" value="pick" :disabled="!docs.length" />
        <span>{{ app.currentDocId ? '选择文档（单选）' : '选择文档（单选，当前未打开文档）' }}</span>
      </label>
      <label class="sp-opt">
        <input v-model="scope" type="radio" value="all" :disabled="!docs.length" />
        <span>全部文档（{{ docs.length }} 篇）</span>
      </label>

      <div v-if="scope === 'pick'" class="sp-list">
        <label v-for="d in docs" :key="d.id" class="sp-doc" :class="{ on: pickId === d.id }">
          <input v-model="pickId" type="radio" :value="d.id" name="sp-pick" />
          <span class="sp-doc-title">{{ d.title }}</span>
          <span class="sp-doc-time">{{ new Date(d.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</span>
        </label>
        <p v-if="!docs.length" class="sp-empty">文档库还没有文档。</p>
      </div>

      <div class="sp-foot">
        <button class="btn primary" :disabled="busy || (scope === 'pick' && !pickId) || !docs.length || (scope === 'current' && !app.currentDocId)" @click="confirm">
          {{ busy ? '同步中…' : confirmLabel() }}
        </button>
      </div>
    </template>

    <template v-else>
      <p class="sp-done">
        已提交 {{ result.count }} 篇文档。
        {{ result.online ? '手机在线，几秒内会自动收取。' : '手机当前不在线，已暂存；下次打开手机上的「文转条图」会自动收取。' }}
      </p>
      <div class="sp-foot">
        <button class="btn" @click="emit('close')">完成</button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.sp-tip {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
}

.sp-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 7px 0;
}

.sp-list {
  margin-top: 6px;
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px 0;
}

.sp-doc {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 13px;
  cursor: pointer;
}

.sp-doc.on {
  background: var(--panel-soft);
}

.sp-doc-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-doc-time {
  color: var(--muted);
  font-size: 11px;
  flex-shrink: 0;
}

.sp-empty {
  padding: 10px 12px;
  color: var(--muted);
  font-size: 12px;
}

.sp-foot {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.sp-done {
  font-size: 13px;
  line-height: 1.7;
  margin: 0;
}
</style>
