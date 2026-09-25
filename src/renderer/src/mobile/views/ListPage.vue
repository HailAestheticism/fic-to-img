<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MobileDoc } from '../store'
import { displayName, newLocalDoc, previewOf, store } from '../store'

const query = ref('')

const filtered = computed<MobileDoc[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return store.docs
  return store.docs.filter((d) => displayName(d).toLowerCase().includes(q) || d.body.toLowerCase().includes(q))
})

function fmtDate(n: number): string {
  const d = new Date(n)
  const today = new Date()
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `今天 ${hm}`
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

function openDoc(id: string): void {
  store.editId = id
  store.view = 'edit'
}

function create(): void {
  const doc = newLocalDoc()
  store.editId = doc.id
  store.view = 'edit'
}
</script>

<template>
  <div class="lp">
    <header class="lp-head">
      <h1>文转条图</h1>
      <button class="lp-sync" title="同步" @click="store.view = 'sync'">
        <span class="lp-dot" :class="{ on: store.pcOnline === true, off: store.pcOnline === false }"></span>
        同步
      </button>
    </header>

    <div class="lp-search-wrap">
      <input v-model="query" class="lp-search" type="search" placeholder="搜索标题或正文" />
    </div>

    <div class="lp-list">
      <button v-for="d in filtered" :key="d.id" class="lp-card" @click="openDoc(d.id)">
        <div class="lp-card-title">{{ displayName(d) }}</div>
        <div class="lp-card-body" :class="{ empty: !previewOf(d) }">{{ previewOf(d) || '（无正文）' }}</div>
        <div class="lp-card-time">{{ fmtDate(d.updatedAt) }}</div>
      </button>

      <div v-if="store.ready && !store.docs.length" class="lp-empty">
        <p>还没有文档。</p>
        <p>在电脑端「移动端同步」里把文档推过来，或点右下角 ＋ 新建。</p>
      </div>
      <div v-else-if="store.ready && store.docs.length && !filtered.length" class="lp-empty">
        <p>没有匹配「{{ query }}」的文档。</p>
      </div>
    </div>

    <button class="lp-fab" title="新建文档" @click="create">＋</button>
  </div>
</template>

<style scoped>
.lp {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.lp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(10px + env(safe-area-inset-top)) 18px 6px;
}

.lp-head h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.lp-sync {
  display: flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: none;
  font-size: 13px;
  color: #6d7370;
  padding: 6px 4px;
}

.lp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c9cdca;
}

.lp-dot.on {
  background: #3f8f5f;
}

.lp-dot.off {
  background: #d66a5a;
}

.lp-search-wrap {
  padding: 6px 16px 10px;
}

.lp-search {
  width: 100%;
  height: 38px;
  border: none;
  background: #f3f4f4;
  border-radius: 10px;
  padding: 0 14px;
  font-size: 14px;
  color: #1d1f1e;
  outline: none;
}

.lp-list {
  flex: 1;
  overflow-y: auto;
  padding: 2px 12px calc(96px + env(safe-area-inset-bottom));
}

.lp-card {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: #f7f8f8;
  border-radius: 14px;
  padding: 14px 16px 11px;
  margin-top: 10px;
  color: inherit;
}

.lp-card-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lp-card-body {
  margin-top: 5px;
  font-size: 13px;
  line-height: 1.65;
  color: #8a908c;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  white-space: pre-line;
}

.lp-card-body.empty {
  color: #c1c5c2;
}

.lp-card-time {
  margin-top: 7px;
  font-size: 11px;
  color: #b3b8b5;
}

.lp-empty {
  padding: 64px 32px;
  text-align: center;
  color: #a5aaa7;
  font-size: 13px;
  line-height: 1.9;
}

.lp-empty p {
  margin: 0;
}

.lp-fab {
  position: fixed;
  right: 22px;
  bottom: calc(26px + env(safe-area-inset-bottom));
  width: 54px;
  height: 54px;
  border-radius: 50%;
  border: none;
  background: #3f8f5f;
  color: #fff;
  font-size: 26px;
  line-height: 1;
  box-shadow: 0 6px 18px rgba(63, 143, 95, 0.35);
}
</style>
