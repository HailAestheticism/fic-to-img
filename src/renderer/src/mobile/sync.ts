import type { MobilePushDoc, MobilePushResultItem } from '@shared/types'
import { getToken, setToken } from './token'
import { showToast, store, upsertFromPc } from './store'

/** 电脑端 API 客户端：页面永远与 PC 服务同源，直接相对路径即可 */

export function captureTokenFromUrl(): boolean {
  const url = new URL(location.href)
  const t = url.searchParams.get('t')
  if (!t) return false
  setToken(t)
  url.searchParams.delete('t')
  const qs = url.searchParams.toString()
  history.replaceState(null, '', url.pathname + (qs ? `?${qs}` : '') + url.hash)
  return true
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const t = getToken()
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${path}${sep}t=${encodeURIComponent(t)}`, { cache: 'no-store', ...init })
  if (res.status === 403) throw new Error('口令无效：请在手机端「同步」页重新填写电脑端口令')
  if (!res.ok) throw new Error(`电脑端返回错误 ${res.status}`)
  return (await res.json()) as T
}

export async function health(): Promise<{ ok: boolean; name: string; version: string; time: number }> {
  return request('/api/health')
}

export async function fetchInbox(): Promise<MobilePushDoc[]> {
  const r = await request<{ docs: MobilePushDoc[] }>('/api/inbox')
  return Array.isArray(r.docs) ? r.docs : []
}

export async function ackInbox(): Promise<void> {
  await request('/api/inbox/ack', { method: 'POST' })
}

export async function pushDocs(docs: { id: string; title: string; body: string }[]): Promise<MobilePushResultItem[]> {
  const r = await request<{ results: MobilePushResultItem[] }>('/api/push', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ docs })
  })
  return r.results
}

let polling = false

/** 收取电脑端推送：应用进本地库后回执 */
export async function pollOnce(): Promise<void> {
  if (polling || !getToken()) return
  polling = true
  try {
    const docs = await fetchInbox()
    store.pcOnline = true
    store.pcError = ''
    if (docs.length) {
      for (const d of docs) await upsertFromPc(d)
      store.lastRecvAt = Date.now()
      await ackInbox()
      showToast(`已收到电脑端同步的 ${docs.length} 篇文档`)
    }
  } catch (e) {
    store.pcOnline = false
    store.pcError = e instanceof Error ? e.message : String(e)
  } finally {
    polling = false
  }
}

let timerStarted = false

/** 前台每 5 秒收取一次；App 切回前台立即补一次 */
export function startPolling(): void {
  if (timerStarted) return
  timerStarted = true
  void pollOnce()
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void pollOnce()
  }, 5000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pollOnce()
  })
}
