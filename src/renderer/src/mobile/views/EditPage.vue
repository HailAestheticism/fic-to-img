<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { deleteLocalDoc, editTarget, persistDoc, store, showToast } from '../store'
import ScopeDialog from '../components/ScopeDialog.vue'

const doc = editTarget()
const showScope = ref(false)
const richHint = ref(false)

let timer: ReturnType<typeof setTimeout> | null = null

function scheduleSave(): void {
  if (!doc) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    if (doc) void persistDoc(doc)
  }, 600)
}

async function flushSave(): Promise<void> {
  if (!doc) return
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  await persistDoc(doc)
}

async function back(): Promise<void> {
  await flushSave()
  store.editId = ''
  store.view = 'list'
}

async function remove(): Promise<void> {
  if (!doc) return
  const name = doc.title.trim() || doc.pcName.trim() || '无标题'
  if (!confirm(`删除《${name}》？只删除手机上的副本，不影响电脑。`)) return
  if (timer) clearTimeout(timer)
  await deleteLocalDoc(doc.id)
  store.view = 'list'
  showToast('已删除（电脑端不受影响）')
}

onMounted(() => {
  if (!doc) {
    store.view = 'list'
    return
  }
  richHint.value = doc.rich
})

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div v-if="doc" class="ep">
    <header class="ep-head">
      <button class="ep-back" title="返回" @click="back">←</button>
      <div class="ep-head-right">
        <button class="ep-act" title="删除" @click="remove">删除</button>
        <button class="ep-act primary" title="把本文档同步到电脑" @click="showScope = true">同步到电脑</button>
      </div>
    </header>

    <p v-if="richHint" class="ep-warn">电脑端这篇文档含排版（标题层级、图片等），覆盖同步回去后不会还原。</p>

    <input v-model="doc.title" class="ep-title" type="text" placeholder="大标题" @input="scheduleSave" />
    <p v-if="!doc.h0Sync && doc.pcName.trim()" class="ep-pcname">文档名：{{ doc.pcName.trim() }}</p>
    <textarea v-model="doc.body" class="ep-body" placeholder="正文" @input="scheduleSave"></textarea>

    <ScopeDialog v-if="showScope" :current-id="doc.id" @close="showScope = false" />
  </div>
</template>

<style scoped>
.ep {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.ep-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(8px + env(safe-area-inset-top)) 12px 6px;
}

.ep-back {
  width: 40px;
  height: 40px;
  border: none;
  background: none;
  font-size: 22px;
  color: #3f8f5f;
}

.ep-head-right {
  display: flex;
  gap: 4px;
}

.ep-act {
  border: none;
  background: none;
  font-size: 13px;
  color: #8a908c;
  padding: 10px 8px;
}

.ep-act.primary {
  color: #3f8f5f;
  font-weight: 500;
}

.ep-warn {
  margin: 0;
  padding: 4px 18px 0;
  font-size: 11px;
  line-height: 1.6;
  color: #b0724a;
}

.ep-title {
  margin: 6px 18px 0;
  border: none;
  outline: none;
  font-size: 21px;
  font-weight: 700;
  color: #1d1f1e;
  padding: 6px 0;
  background: none;
}

.ep-title::placeholder {
  color: #c9cdca;
}

.ep-pcname {
  margin: 0 18px;
  font-size: 11px;
  color: #b3b8b5;
}

.ep-body {
  flex: 1;
  margin: 2px 18px calc(14px + env(safe-area-inset-bottom));
  border: none;
  outline: none;
  resize: none;
  font-size: 16px;
  line-height: 1.85;
  color: #2b2e2d;
  background: none;
}

.ep-body::placeholder {
  color: #c9cdca;
}
</style>
