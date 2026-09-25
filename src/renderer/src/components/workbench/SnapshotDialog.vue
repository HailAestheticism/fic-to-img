<script setup lang="ts">
import { ref } from 'vue'
import type { SnapshotInfo } from '@shared/types'
import { useDocStore } from '../../stores/doc'
import Modal from '../common/Modal.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const doc = useDocStore()
const busy = ref(false)
const pendingDelete = ref('')

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function label(s: SnapshotInfo): string {
  return s.label || (s.label === '' ? '手动快照' : '快照')
}

async function run(fn: () => Promise<void>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
  } finally {
    busy.value = false
  }
}

async function create(): Promise<void> {
  await run(async () => {
    await doc.createSnapshot('手动快照')
    pendingDelete.value = ''
  })
}

async function restore(name: string): Promise<void> {
  await run(async () => {
    await doc.restoreSnapshot(name)
    emit('close')
  })
}

async function remove(name: string): Promise<void> {
  await run(async () => {
    await doc.deleteSnapshot(name)
    pendingDelete.value = ''
  })
}
</script>

<template>
  <Modal title="版本快照" @close="emit('close')">
    <div class="snap-head">
      <span class="muted">恢复会用快照内容覆盖当前文档；快照最多保留 {{ doc.settings?.maxSnapshots ?? 30 }} 份。</span>
      <button class="btn small primary" :disabled="busy" @click="void create()">＋ 保存当前快照</button>
    </div>

    <p v-if="!doc.snapshots.length" class="muted snap-empty">暂无快照，先保存一份再试。</p>
    <ul v-else class="snap-list">
      <li v-for="s in doc.snapshots" :key="s.name" class="snap-row">
        <div class="snap-meta">
          <strong>{{ label(s) }}</strong>
          <span class="muted">{{ fmtTime(s.savedAt) }} · {{ fmtSize(s.size) }}</span>
        </div>
        <div class="snap-acts">
          <template v-if="pendingDelete === s.name">
            <span class="muted">确认删除？</span>
            <button class="btn small danger" :disabled="busy" @click="void remove(s.name)">删除</button>
            <button class="btn small" :disabled="busy" @click="pendingDelete = ''">取消</button>
          </template>
          <template v-else>
            <button class="btn small" :disabled="busy" @click="void restore(s.name)">恢复</button>
            <button class="btn small ghost" :disabled="busy" @click="pendingDelete = s.name">删除</button>
          </template>
        </div>
      </li>
    </ul>

    <template #footer>
      <button class="btn" @click="emit('close')">关闭</button>
    </template>
  </Modal>
</template>

<style scoped>
.snap-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  margin-bottom: 10px;
}

.snap-empty {
  padding: 18px 0;
  text-align: center;
  font-size: 13px;
}

.snap-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 46vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.snap-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
}

.snap-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}

.snap-meta .muted {
  font-size: 11px;
  font-family: Consolas, monospace;
}

.snap-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
</style>
