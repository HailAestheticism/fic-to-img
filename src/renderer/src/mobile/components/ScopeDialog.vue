<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MobileDoc } from '../store'
import { displayName, store, showToast } from '../store'
import { pushDocs } from '../sync'

const props = defineProps<{ currentId?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const scope = ref<'current' | 'pick' | 'all'>(props.currentId ? 'current' : 'pick')
const pickId = ref(store.docs.find((d) => d.id !== props.currentId)?.id ?? store.docs[0]?.id ?? '')
const busy = ref(false)

const currentDoc = computed<MobileDoc | null>(() => store.docs.find((d) => d.id === props.currentId) ?? null)

function fmtTime(n: number): string {
  return new Date(n).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function confirm(): Promise<void> {
  if (busy.value) return
  let docs: MobileDoc[] = []
  if (scope.value === 'all') docs = store.docs
  else if (scope.value === 'current' && currentDoc.value) docs = [currentDoc.value]
  else docs = store.docs.filter((d) => d.id === pickId.value)
  if (!docs.length) {
    showToast('没有可同步的文档')
    return
  }
  busy.value = true
  try {
    await pushDocs(docs.map((d) => ({ id: d.id, title: d.title, body: d.body })))
    showToast(`已把 ${docs.length} 篇文档同步到电脑（电脑端内容将被本机内容覆盖）`)
    emit('close')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    showToast(store.pcOnline === false ? `同步失败：连不上电脑（${msg}）` : `同步失败：${msg}`)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="sheet-mask" @click.self="emit('close')">
    <div class="sheet">
      <h3>同步到电脑</h3>
      <p class="sh-tip">单向覆盖：电脑上这些文档会被手机的「大标题 + 正文」纯文本替换，电脑端排版不会保留。</p>

      <label v-if="currentDoc" class="sh-opt">
        <input v-model="scope" type="radio" value="current" />
        <span>当前文档《{{ displayName(currentDoc) }}》</span>
      </label>
      <label class="sh-opt">
        <input v-model="scope" type="radio" value="pick" :disabled="!store.docs.length" />
        <span>选择文档（单选）</span>
      </label>
      <label class="sh-opt">
        <input v-model="scope" type="radio" value="all" :disabled="!store.docs.length" />
        <span>全部文档（{{ store.docs.length }} 篇）</span>
      </label>

      <div v-if="scope === 'pick'" class="sh-list">
        <label v-for="d in store.docs" :key="d.id" class="sh-doc" :class="{ on: pickId === d.id }">
          <input v-model="pickId" type="radio" name="sh-pick" :value="d.id" />
          <span class="sh-doc-name">{{ displayName(d) }}</span>
          <span class="sh-doc-time">{{ fmtTime(d.updatedAt) }}</span>
        </label>
      </div>

      <div class="sh-foot">
        <button class="sh-btn" @click="emit('close')">取消</button>
        <button class="sh-btn primary" :disabled="busy || !store.docs.length || (scope === 'pick' && !pickId)" @click="confirm">
          {{ busy ? '同步中…' : '同步' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.sheet {
  width: 100%;
  max-width: 560px;
  background: #fff;
  border-radius: 16px 16px 0 0;
  padding: 18px 18px calc(18px + env(safe-area-inset-bottom));
  max-height: 76vh;
  overflow-y: auto;
}

.sheet h3 {
  margin: 0;
  font-size: 16px;
}

.sh-tip {
  margin: 8px 0 6px;
  font-size: 12px;
  line-height: 1.7;
  color: #8a908c;
}

.sh-opt {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 0;
  font-size: 14px;
}

.sh-list {
  max-height: 260px;
  overflow-y: auto;
  border-top: 1px solid #eef0ef;
}

.sh-doc {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 4px;
  font-size: 14px;
  border-bottom: 1px solid #f2f3f2;
}

.sh-doc.on {
  background: #f7f9f8;
}

.sh-doc-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sh-doc-time {
  font-size: 11px;
  color: #a5aaa7;
  flex-shrink: 0;
}

.sh-foot {
  margin-top: 14px;
  display: flex;
  gap: 10px;
}

.sh-btn {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  border: 1px solid #e3e6e4;
  background: #fff;
  font-size: 15px;
  color: #1d1f1e;
}

.sh-btn.primary {
  background: #3f8f5f;
  border-color: #3f8f5f;
  color: #fff;
}

.sh-btn:disabled {
  opacity: 0.45;
}
</style>
