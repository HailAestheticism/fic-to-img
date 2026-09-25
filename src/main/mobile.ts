import { app, BrowserWindow, ipcMain } from 'electron'
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'
import { networkInterfaces, hostname } from 'node:os'
import { randomBytes } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import { join, extname, normalize as pathNormalize } from 'node:path'
import type {
  MobileChangedEvent,
  MobileInboxAckedEvent,
  MobilePushDoc,
  MobilePushResultItem,
  MobileSettings,
  MobileStatus
} from '../shared/types'
import { docToMobile, mobileToDoc } from '../shared/mobile-content'
import { docStore, getDataDir, onDocSaved } from './storage'
import { ensureServerCert } from './certs'

const DEFAULT_PORT = 4646
const MAX_BODY = 8 * 1024 * 1024
/** 与 storage.docDir() 同一套 ID 规则，非法 ID 不必再靠异常兜住 */
const DOC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Syncthing 等外部改动的轮询间隔 */
const WATCH_INTERVAL = 5000
/** 手机拉取收件箱即视为在线的窗口期 */
const ONLINE_WINDOW = 20_000
/** 构建产物里的手机端页面与静态资源（electron-vite renderer 双入口之一） */
const RENDERER_DIR = join(__dirname, '../renderer')

let gateServer: NetServer | null = null
let httpServer: Server | null = null
let httpsServer: Server | null = null
let config: MobileSettings = { enabled: false, port: DEFAULT_PORT, token: newToken() }
let lastError = ''
let watcher: ReturnType<typeof setInterval> | null = null
let diskState = new Map<string, number>()
let selfWriteAt = new Map<string, number>()
/** PC → 手机的待收取推送（按文档 id 去重，后推覆盖前推） */
let inbox: MobilePushDoc[] = []
let phoneLastSeen = 0

function newToken(): string {
  return randomBytes(6).toString('hex')
}

function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address)
    }
  }
  return out
}

function status(): MobileStatus {
  const withToken = (host: string): string => `${host}/?t=${config.token}`
  const running = gateServer !== null
  return {
    ...config,
    running,
    urls: running ? lanAddresses().map((ip) => withToken(`http://${ip}:${config.port}`)) : [],
    httpsUrls: running ? lanAddresses().map((ip) => withToken(`https://${ip}:${config.port}`)) : [],
    caUrls: running ? lanAddresses().map((ip) => `http://${ip}:${config.port}/ca.crt`) : [],
    error: lastError || undefined,
    phoneLastSeen: phoneLastSeen || undefined,
    pendingCount: inbox.length
  }
}

function phoneOnline(): boolean {
  return gateServer !== null && Date.now() - phoneLastSeen < ONLINE_WINDOW
}

async function persist(): Promise<void> {
  const settings = await docStore.readSettings()
  await docStore.writeSettingsFile({ ...settings, mobile: config })
}

async function load(): Promise<void> {
  const saved = (await docStore.readSettings()).mobile
  if (saved) config = { enabled: !!saved.enabled, port: saved.port || DEFAULT_PORT, token: saved.token || newToken() }
  await persist()
}

// ---------- 收件箱（PC → 手机）持久化 ----------

function inboxFile(): string {
  return join(getDataDir(), 'mobile-inbox.json')
}

async function persistInbox(): Promise<void> {
  try {
    const file = inboxFile()
    const tmp = `${file}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(inbox), 'utf8')
    await fsp.rename(tmp, file)
  } catch (e) {
    console.error('[mobile] 收件箱写入失败:', e)
  }
}

async function loadInbox(): Promise<void> {
  try {
    const data = JSON.parse(await fsp.readFile(inboxFile(), 'utf8')) as MobilePushDoc[]
    inbox = Array.isArray(data) ? data.filter((d) => d && DOC_ID_RE.test(d.id)) : []
  } catch {
    inbox = []
  }
}

// ---------- HTTP ----------

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.crt': 'application/x-x509-ca-cert'
}

function json(res: ServerResponse, code: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  res.end(body)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('内容过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function broadcastChanged(e: MobileChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mobile:changed', e)
  }
}

function broadcastInboxAcked(e: MobileInboxAckedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('mobile:inbox-acked', e)
  }
}

/** 静态文件：只允许 RENDERER_DIR 内的白名单文件，防目录穿越 */
async function serveStatic(res: ServerResponse, relPath: string): Promise<boolean> {
  const full = pathNormalize(join(RENDERER_DIR, relPath))
  if (!full.startsWith(RENDERER_DIR)) return false
  try {
    const data = await fsp.readFile(full)
    const type = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream'
    res.writeHead(200, {
      'content-type': type,
      'content-length': data.length,
      // 带 hash 的 assets 可长缓存；sw.js / html 走 no-store 由调用方覆写
      'cache-control': relPath.startsWith('assets/') ? 'public, max-age=604800' : 'no-store'
    })
    res.end(data)
    return true
  } catch {
    return false
  }
}

/** 手机端 → PC：把纯文本文档应用进文档库 */
async function applyMobileDoc(m: MobilePushDoc, existingIds: Set<string>): Promise<MobilePushResultItem> {
  try {
    const content = mobileToDoc({ title: m.title, body: m.body })
    if (existingIds.has(m.id)) {
      const bundle = await docStore.getDoc(m.id)
      const meta = { ...bundle.meta }
      // 标题联动关：文档名保持 PC 端自己的，不跟随手机大标题
      if (meta.h0Sync !== false && m.title.trim()) meta.title = m.title.trim()
      const r = await docStore.saveDoc(m.id, { meta, content })
      broadcastChanged({ docId: m.id, updatedAt: r.savedAt, from: 'phone' })
      return { id: m.id, ok: true }
    }
    const created = await docStore.createDoc({
      id: m.id,
      title: m.title.trim() || '未命名文档',
      content
    })
    broadcastChanged({ docId: created.id, updatedAt: created.updatedAt, from: 'phone' })
    return { id: m.id, ok: true, created: true }
  } catch (e) {
    return { id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** PC → 手机：按文档 id 合并入收件箱（后推覆盖前推），手机在线时几秒内自动收取 */
async function syncToPhone(docIds: string[]): Promise<{ online: boolean; count: number }> {
  const pushed: MobilePushDoc[] = []
  for (const id of docIds) {
    if (!DOC_ID_RE.test(id)) continue
    const bundle = await docStore.getDoc(id)
    const proj = docToMobile(bundle.content)
    pushed.push({
      id,
      title: proj.title,
      body: proj.body,
      h0Sync: bundle.meta.h0Sync !== false,
      pcName: bundle.meta.title,
      rich: proj.rich
    })
  }
  const map = new Map(inbox.map((d) => [d.id, d]))
  for (const d of pushed) map.set(d.id, d)
  inbox = [...map.values()]
  await persistInbox()
  return { online: phoneOnline(), count: pushed.length }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (url.searchParams.get('t') !== config.token) {
    json(res, 403, { error: '口令无效，请在电脑端重新获取访问地址' })
    return
  }

  if (url.pathname === '/api/health' && req.method === 'GET') {
    phoneLastSeen = Date.now()
    json(res, 200, { ok: true, name: '文转条图', version: app.getVersion(), time: Date.now() })
    return
  }

  if (url.pathname === '/api/pc-info' && req.method === 'GET') {
    json(res, 200, { name: hostname(), version: app.getVersion() })
    return
  }

  if (url.pathname === '/api/inbox' && req.method === 'GET') {
    phoneLastSeen = Date.now()
    json(res, 200, { docs: inbox })
    return
  }

  if (url.pathname === '/api/inbox/ack' && req.method === 'POST') {
    const count = inbox.length
    inbox = []
    await persistInbox()
    broadcastInboxAcked({ count })
    json(res, 200, { ok: true })
    return
  }

  if (url.pathname === '/api/push' && req.method === 'POST') {
    let payload: { docs?: MobilePushDoc[] }
    try {
      payload = JSON.parse(await readBody(req)) as { docs?: MobilePushDoc[] }
    } catch {
      json(res, 400, { error: '请求体不是有效 JSON' })
      return
    }
    const docs = Array.isArray(payload.docs) ? payload.docs : []
    if (!docs.length || docs.length > 500) {
      json(res, 400, { error: '没有可同步的文档' })
      return
    }
    if (docs.some((d) => !d || !DOC_ID_RE.test(String(d.id ?? '')))) {
      json(res, 400, { error: '文档 ID 无效' })
      return
    }
    const existingIds = new Set((await docStore.listDocs()).map((d) => d.id))
    const results: MobilePushResultItem[] = []
    for (const d of docs) {
      results.push(await applyMobileDoc({ ...d, id: String(d.id), title: String(d.title ?? ''), body: String(d.body ?? '') }, existingIds))
      if (results.at(-1)?.ok) existingIds.add(String(d.id))
    }
    json(res, 200, { results })
    return
  }

  json(res, 404, { error: 'not found' })
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const pathname = url.pathname

  if (pathname.startsWith('/api/')) {
    try {
      await handleApi(req, res, url)
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      console.error('[mobile] 请求失败:', lastError)
      if (!res.headersSent) json(res, 500, { error: lastError })
    }
    return
  }

  if (pathname === '/' || pathname === '/index.html' || pathname === '/mobile.html') {
    if (!(await serveStatic(res, 'mobile.html'))) {
      json(res, 404, { error: '手机端页面缺失：请先在电脑端执行一次构建（npm run build）' })
    }
    return
  }

  if (pathname === '/manifest.webmanifest') {
    const manifest = {
      name: '文转条图',
      short_name: '文转条图',
      start_url: `/?t=${config.token}`,
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#ffffff',
      theme_color: '#ffffff',
      icons: [{ src: '/mobile-icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any maskable' }]
    }
    const body = JSON.stringify(manifest)
    res.writeHead(200, { 'content-type': MIME['.webmanifest'], 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
    res.end(body)
    return
  }

  if (pathname === '/ca.crt') {
    try {
      const ca = await fsp.readFile(join(getDataDir(), 'certs', 'ca.crt'))
      res.writeHead(200, { 'content-type': MIME['.crt'], 'content-length': ca.length, 'cache-control': 'no-store' })
      res.end(ca)
    } catch {
      json(res, 404, { error: '证书尚未生成，请先在电脑端开启移动端同步服务' })
    }
    return
  }

  if (await serveStatic(res, pathname.slice(1))) return
  json(res, 404, { error: 'not found' })
}

// ---------- 服务生命周期（单端口同时接 HTTP 与 TLS：按首字节 0x16 分流） ----------

async function startServers(): Promise<void> {
  if (gateServer) return
  let tlsOk = false
  try {
    const cert = await ensureServerCert(getDataDir(), lanAddresses())
    httpsServer = createHttpsServer({ key: cert.serverKey, cert: cert.serverCrt }, handle)
    httpsServer.on('tlsClientError', () => {/* 口令扫描/非 TLS 探测，忽略 */})
    tlsOk = true
  } catch (e) {
    console.error('[mobile] 证书生成失败，仅提供 HTTP 访问:', e)
  }
  httpServer = createHttpServer(handle)

  await new Promise<void>((resolve) => {
    const gate = createNetServer((socket: Socket) => {
      socket.once('data', (chunk: Buffer) => {
        socket.pause()
        socket.unshift(chunk)
        const target = chunk[0] === 0x16 ? httpsServer : httpServer
        if (target) (target as unknown as Server).emit('connection', socket)
        process.nextTick(() => socket.resume())
      })
    })
    gate.on('error', (e: NodeJS.ErrnoException) => {
      lastError = e.code === 'EADDRINUSE' ? `端口 ${config.port} 已被占用` : e.message
      resolve()
    })
    gate.listen(config.port, '0.0.0.0', () => {
      gateServer = gate
      lastError = ''
      console.log(`[mobile] 服务已启动（端口 ${config.port}${tlsOk ? '，HTTPS 就绪' : '，仅 HTTP'}）`)
      resolve()
    })
  })
}

function startWatcher(): void {
  if (watcher) return
  const dir = join(getDataDir(), 'documents')
  watcher = setInterval(async () => {
    try {
      const names = await fsp.readdir(dir)
      for (const name of names) {
        if (!/^[0-9a-f-]{36}$/i.test(name)) continue
        let updatedAt = 0
        try {
          const meta = JSON.parse(await fsp.readFile(join(dir, name, 'meta.json'), 'utf8')) as { updatedAt?: number }
          updatedAt = Number(meta.updatedAt ?? 0)
        } catch {
          continue
        }
        const prev = diskState.get(name)
        diskState.set(name, updatedAt)
        if (prev === undefined || prev === updatedAt) continue
        if (selfWriteAt.get(name) === updatedAt) continue
        broadcastChanged({ docId: name, updatedAt, from: 'sync' })
      }
    } catch {
      /* 数据目录尚未创建 */
    }
  }, WATCH_INTERVAL)
  watcher.unref?.()
}

async function stop(): Promise<void> {
  if (gateServer) {
    gateServer.close()
    ;(gateServer as unknown as { closeAllConnections?: () => void }).closeAllConnections?.()
    gateServer = null
  }
  if (httpServer) {
    httpServer.close()
    httpServer.closeAllConnections?.()
    httpServer = null
  }
  if (httpsServer) {
    httpsServer.close()
    httpsServer.closeAllConnections?.()
    httpsServer = null
  }
  if (watcher) {
    clearInterval(watcher)
    watcher = null
  }
}

export async function setEnabled(enabled: boolean): Promise<MobileStatus> {
  config = { ...config, enabled }
  await persist()
  if (enabled) return await start()
  await stop()
  return status()
}

export async function setPort(port: number): Promise<MobileStatus> {
  const next = Math.min(65535, Math.max(1024, Math.round(port) || DEFAULT_PORT))
  config = { ...config, port: next }
  await persist()
  if (gateServer) {
    await stop()
    return await start()
  }
  // 之前启动失败（如端口被占）时改端口应当即重试，而不是让旧错误一直挂着
  if (config.enabled) return await start()
  return status()
}

export async function rotateToken(): Promise<MobileStatus> {
  config = { ...config, token: newToken() }
  await persist()
  return status()
}

async function start(): Promise<MobileStatus> {
  if (gateServer) return status()
  phoneLastSeen = 0
  await startServers()
  if (gateServer) startWatcher()
  return status()
}

export function registerMobileIpc(): void {
  ipcMain.handle('mobile:status', () => status())
  ipcMain.handle('mobile:setEnabled', (_e, enabled: boolean) => setEnabled(enabled))
  ipcMain.handle('mobile:setPort', (_e, port: number) => setPort(port))
  ipcMain.handle('mobile:rotateToken', () => rotateToken())
  ipcMain.handle('mobile:syncToPhone', (_e, docIds: string[]) => syncToPhone(docIds))
}

export async function initMobile(): Promise<void> {
  await load()
  await loadInbox()
  onDocSaved((docId, updatedAt) => {
    selfWriteAt.set(docId, updatedAt)
    diskState.set(docId, updatedAt)
  })
  if (config.enabled) await start()
}
