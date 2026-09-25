<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { DocMeta } from '@shared/types'
import { useLibraryStore } from '../../stores/library'
import Modal from '../common/Modal.vue'

const props = defineProps<{ doc: DocMeta }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', patch: { title: string; folder: string; tags: string[] }): void
}>()

const lib = useLibraryStore()
const folderSuggestions = computed(() => lib.foldersList)

const form = reactive({
  title: props.doc.title,
  folder: props.doc.folder,
  tags: props.doc.tags.join('，')
})

function parseTags(raw: string): string[] {
  return raw
    .split(/[，,;；\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function submit(): void {
  emit('save', { title: form.title.trim() || '未命名文档', folder: form.folder.trim(), tags: parseTags(form.tags) })
}
</script>

<template>
  <Modal title="文档信息" @close="emit('close')">
    <div class="meta-form">
      <label class="field">
        <span>标题</span>
        <input v-model="form.title" class="input" placeholder="文档标题" @keydown.enter="submit" />
      </label>
      <label class="field">
        <span>文件夹</span>
        <input v-model="form.folder" class="input" list="folder-suggestions" placeholder="如：小说/第一卷（留空为未分类）" />
        <datalist id="folder-suggestions">
          <option v-for="f in folderSuggestions" :key="f" :value="f" />
        </datalist>
      </label>
      <label class="field">
        <span>标签</span>
        <input v-model="form.tags" class="input" placeholder="多个标签用逗号分隔" />
      </label>
    </div>
    <template #footer>
      <button class="btn" @click="emit('close')">取消</button>
      <button class="btn primary" @click="submit">保存</button>
    </template>
  </Modal>
</template>

<style scoped>
.meta-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 13px;
  color: var(--ink-soft);
}
</style>
