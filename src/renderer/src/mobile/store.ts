import { reactive } from 'vue'
import { dbAll, dbDelete, dbPut } from './db'
import type { MobilePushDoc } from '@shared/types'

/** 手机端本地文档：只有 大标题 + 纯文本正文，其余字段服务于列表显示与同步 */
export interface MobileDoc {
  id: string
  /** 大标题（H0）文本 */
  title: string
  /** 正文：纯文本，换行即段落；任何 markdown 符号都是普通字符 */
  body: string
  /** PC 端「标题联动」开关：开 → 列表名跟随 title；关 → 列表名用 pcName */
  h0Sync: boolean
  /** PC 端文档名（h0Sync 关时列表显示它） */
  pcName: string
  /** PC 端原文档含手机表达不了的排版（回传不还原提示用） */
  rich: boolean
  createdAt: number
  updatedAt: number
}

type ViewName = 'list' | 'edit' | 'sync'

export const store = reactive({
  ready: false,
  view: 'list' as ViewName,
  editId: '',
  docs: [] as MobileDoc[],
  toast: '',
  /** 电脑端连接状态：null=还没探测过 */
  pcOnline: null as boolean | null,
  pcError: '',
  lastRecvAt: 0
})

let toastTimer: ReturnType<typeof setTimeout> | null = null

export function showToast(text: string): void {
  store.toast = text
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (store.toast = ''), 3600)
}

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export async function initStore(): Promise<void> {
  const all = await dbAll<MobileDoc>()
  store.docs = all.sort((a, b) => b.updatedAt - a.updatedAt)
  store.ready = true
}

function resort(): void {
  store.docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** 列表显示名：标题联动开 → 大标题；关 → PC 端文档名（需求 3） */
export function displayName(d: MobileDoc): string {
  if (!d.h0Sync && d.pcName.trim()) return d.pcName.trim()
  return d.title.trim() || '无标题'
}

export function previewOf(d: MobileDoc): string {
  return d.body.replace(/\r\n/g, '\n').trim()
}

export function newLocalDoc(): MobileDoc {
  const now = Date.now()
  const doc: MobileDoc = { id: uuid(), title: '', body: '', h0Sync: true, pcName: '', rich: false, createdAt: now, updatedAt: now }
  store.docs.unshift(doc)
  void dbPut(doc)
  return doc
}

export async function persistDoc(d: MobileDoc): Promise<void> {
  d.updatedAt = Date.now()
  resort()
  await dbPut({ ...d })
}

export async function deleteLocalDoc(id: string): Promise<void> {
  const i = store.docs.findIndex((d) => d.id === id)
  if (i >= 0) store.docs.splice(i, 1)
  if (store.editId === id) store.editId = ''
  await dbDelete(id)
}

/** 电脑端推送落地：按 id 覆盖（就地 mutate，保持编辑页绑定），并写入 IndexedDB */
export async function upsertFromPc(m: MobilePushDoc): Promise<MobileDoc> {
  const now = Date.now()
  const existing = store.docs.find((d) => d.id === m.id)
  if (existing) {
    existing.title = m.title
    existing.body = m.body
    existing.h0Sync = m.h0Sync
    existing.pcName = m.pcName ?? ''
    existing.rich = !!m.rich
    existing.updatedAt = now
    resort()
    await dbPut({ ...existing })
    return existing
  }
  const doc: MobileDoc = {
    id: m.id,
    title: m.title,
    body: m.body,
    h0Sync: m.h0Sync,
    pcName: m.pcName ?? '',
    rich: !!m.rich,
    createdAt: now,
    updatedAt: now
  }
  store.docs.unshift(doc)
  await dbPut({ ...doc })
  return doc
}

export function editTarget(): MobileDoc | null {
  return store.docs.find((d) => d.id === store.editId) ?? null
}
