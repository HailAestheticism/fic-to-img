import { app, dialog, ipcMain } from 'electron'
import { promises as fsp, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  BackgroundSpec,
  AppInfo,
  CreateDocPayload,
  DocBundle,
  DocCardInfo,
  DocFolder,
  DocLayout,
  DocMeta,
  FileDialogOptions,
  ImportedAsset,
  PMNode,
  Preset,
  SaveDocPayload,
  SaveFileDialogOptions,
  SplitRules,
  SaveResult,
  SearchHit,
  Settings,
  SnapshotData,
  SnapshotInfo,
  SnapshotFile
} from '../shared/types'
import { canvasPatch, resolveDefaultCanvas } from '../shared/paper'
import { defaultLayout, defaultTypography, h0ScaleOf } from '../shared/layout'
import { htmlToPM, markdownToPM, plainTextToPM, pmToText } from './importer'

// ---------- 数据目录 ----------

let dataDirCache: string | null = null

export function getDataDir(): string {
  if (dataDirCache) return dataDirCache
  const userData = app.getPath('userData')
  const cfgPath = join(userData, 'data-location.json')
  let custom: string | null = null
  try {
    custom = JSON.parse(readFileSync(cfgPath, 'utf8'))?.dataDir ?? null
  } catch {
    /* 使用默认位置 */
  }
  if (custom) {
    dataDirCache = custom
  } else if (!app.isPackaged) {
    // `electron out/main/index.js` 直接运行时 getAppPath 指向 out/main，回溯到项目根
    const appPath = app.getAppPath()
    const m = appPath.match(/[\\/]out[\\/]main[\\/]?$/)
    dataDirCache = join(m ? appPath.slice(0, m.index) : appPath, 'data')
  } else {
    const base = dirname(app.getPath('exe'))
    const sideBySide = join(base, 'data')
    try {
      mkdirSync(sideBySide, { recursive: true })
      dataDirCache = sideBySide
    } catch {
      dataDirCache = join(userData, 'data')
    }
  }
  mkdirSync(dataDirCache, { recursive: true })
  return dataDirCache
}

function docsDir(): string {
  return join(getDataDir(), 'documents')
}

function docDir(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`非法文档 ID: ${id}`)
  }
  return join(docsDir(), id)
}

function settingsFile(): string {
  return join(getDataDir(), 'settings.json')
}

function presetsFile(): string {
  return join(getDataDir(), 'presets', 'library.json')
}

// ---------- 原子读写 ----------

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${Date.now()}`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fsp.rm(file, { force: true })
  await fsp.rename(tmp, file)
}

// ---------- 默认值 ----------

export function defaultSettings(): Settings {
  return {
    version: 1,
    snapshotIntervalMinutes: 10,
    maxSnapshots: 30,
    lastOpenedDocId: null,
    seeded: false
  }
}

/** 新建文档的初始版面：默认值套上设置里的「新建文档默认画布」 */
async function newDocLayout(): Promise<DocLayout> {
  const base = defaultLayout()
  const s = await readSettings()
  const preset = resolveDefaultCanvas(s.defaultCanvas, s.customCanvases)
  const { pageSetup, typography } = canvasPatch(preset, base.pageSetup, base.typography)
  return { ...base, pageSetup, typography }
}

/** 首次运行的种子预设 */
function seedPresets(): Preset[] {
  const now = Date.now()
  return [
    {
      id: randomUUID(),
      name: '默认书卷',
      kind: 'combined',
      createdAt: now,
      updatedAt: now,
      data: {
        pageSetup: defaultLayout().pageSetup,
        typography: defaultTypography(),
        background: null
      }
    },
    {
      id: randomUUID(),
      name: '素雅宋白',
      kind: 'combined',
      createdAt: now,
      updatedAt: now,
      data: {
        pageSetup: defaultLayout().pageSetup,
        typography: {
          ...defaultTypography(),
          bodyFont: 'SimSun',
          bodySize: 17,
          bodyLineHeight: '2.1',
          bodyColor: '#26221e',
          headingFont: 'SimHei',
          headingColor: '#3a332c',
          quoteColor: '#6e6558'
        },
        background: { kind: 'color', color: '#fbfaf7' }
      }
    }
  ]
}

async function readPresets(): Promise<Preset[]> {
  try {
    const raw = await fsp.readFile(presetsFile(), 'utf8')
    return JSON.parse(raw) as Preset[]
  } catch {
    const seeds = seedPresets()
    await writeJsonAtomic(presetsFile(), seeds)
    return seeds
  }
}

function readPresetsSync(): Preset[] {
  try {
    return JSON.parse(readFileSync(presetsFile(), 'utf8')) as Preset[]
  } catch {
    return seedPresets()
  }
}

async function writePresets(list: Preset[]): Promise<Preset[]> {
  await writeJsonAtomic(presetsFile(), list)
  return list
}

function emptyDoc(): PMNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

/** 代码块已从编辑器 Schema 中移除：读入旧正文时把它降级成普通段落（代码每行一段） */
function stripCodeBlocks(node: PMNode): PMNode[] {
  if (node.type === 'codeBlock') {
    const text = (node.content ?? []).map((c) => c.text ?? '').join('\n')
    const lines = text.split('\n').filter((l) => l.trim() !== '')
    if (!lines.length) return [{ type: 'paragraph' }]
    return lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] }))
  }
  if (!Array.isArray(node.content)) return [{ ...node }]
  const content = node.content.flatMap(stripCodeBlocks)
  return [{ ...node, content: content.length ? content : [{ type: 'paragraph' }] }]
}

/** 正文 JSON 的统一读入口：历史文件里可能仍有 codeBlock 节点 */
async function readContent(docId: string): Promise<PMNode> {
  const raw = await readJson<PMNode>(join(docDir(docId), 'content.json'), emptyDoc())
  return { ...raw, content: (raw.content ?? []).flatMap(stripCodeBlocks) }
}

async function readMeta(id: string): Promise<DocMeta> {
  return readJson<DocMeta>(join(docDir(id), 'meta.json'), {
    id,
    title: '未命名文档',
    tags: [],
    folder: '',
    createdAt: 0,
    updatedAt: 0
  })
}

// ---------- 欢迎文档（首次启动引导） ----------

function welcomeDoc(): PMNode {
  const p = (text: string): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const h = (level: number, text: string): PMNode => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }]
  })
  return {
    type: 'doc',
    content: [
      h(1, '欢迎使用文转条图'),
      p('这是一个纯本地单机的文字转条图工具：左侧文档库管理你的作品，这里专注写作，最后按章节导出高清分页图片。'),
      h(2, '快速上手'),
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '工具栏可以设置标题、字体、字号、行距、对齐、缩进和颜色。' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '直接把图片拖进编辑器即可插入，图片会存进文档的 assets 文件夹。' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '内容会自动保存；「快照」菜单可以随时手动保存版本并恢复。' }] }] }
      ] },
      h(2, '支持的内容类型'),
      p('标题、段落、图片、表格、引用、分割线都支持：'),
      { type: 'blockquote', content: [p('这是一段引用示例——适合放箴言或摘要。')] },
      {
        type: 'table',
        attrs: { withHeaderRow: true },
        content: [
          { type: 'tableRow', content: [
            { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p('章节')] },
            { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p('状态')] }
          ] },
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p('第一章')] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p('写作中')] }
          ] }
        ]
      },
      { type: 'horizontalRule' },
      p('删除这份文档不影响使用。祝写作愉快！')
    ]
  }
}

// ---------- 文档操作 ----------

/** 欢迎文档是程序生成的样板，改名/删代码块后要把已落盘的旧样板一并更新（只认「欢迎使用」开头的标题，绝不碰用户自己的文档） */
const WELCOME_FIXES: [string, string][] = [
  ['纯本地单机的流式长文编辑器', '纯本地单机的文字转条图工具'],
  ['标题、段落、图片、表格、引用、代码块、分割线都支持：', '标题、段落、图片、表格、引用、分割线都支持：'],
  ['长文编辑器', '文转条图']
]

function fixWelcomeText(s: string): string {
  return WELCOME_FIXES.reduce((acc, [from, to]) => acc.split(from).join(to), s)
}

/** 旧样板里的代码块整块丢弃（编辑器已无该节点，若按读取时的规则转成段落，示例文档里又会冒出一行代码） */
function dropCodeBlocks(node: PMNode): PMNode {
  if (!Array.isArray(node.content)) return { ...node }
  const kept = node.content.filter((c) => c.type !== 'codeBlock')
  return { ...node, content: kept.map(dropCodeBlocks) }
}

let welcomeMigration: Promise<void> | null = null

/** 每进程跑一次，挂在 docs:list 最前面，保证界面看到的就是改好的样板 */
function migrateWelcomeDocOnce(): Promise<void> {
  if (!welcomeMigration) welcomeMigration = migrateWelcomeDoc().catch(() => void 0)
  return welcomeMigration
}

async function migrateWelcomeDoc(): Promise<void> {
  for (const card of await listDocs()) {
    const dir = docDir(card.id)
    const metaFile = join(dir, 'meta.json')
    // 直接读原始 meta.json 再回写，避免 readMeta 的归一化丢掉旧字段
    const meta = await readJson<Record<string, unknown> | null>(metaFile, null)
    const titleOld = typeof meta?.title === 'string' ? meta.title : ''
    if (!titleOld.startsWith('欢迎使用')) continue
    const contentFile = join(dir, 'content.json')
    const raw = await readJson<PMNode | null>(contentFile, null)
    if (!raw) continue
    const next = dropCodeBlocks(raw)
    const walk = (node: PMNode): void => {
      if (node.type === 'text' && typeof node.text === 'string') node.text = fixWelcomeText(node.text)
      ;(node.content ?? []).forEach(walk)
    }
    walk(next)
    const titleNew = fixWelcomeText(titleOld)
    if (titleNew === titleOld && JSON.stringify(next) === JSON.stringify(raw)) continue
    await fsp.copyFile(contentFile, join(dir, 'content.json.bak-welcome')).catch(() => void 0)
    await writeJsonAtomic(contentFile, next)
    await writeJsonAtomic(metaFile, { ...meta, title: titleNew })
  }
}

async function createDoc(payload: CreateDocPayload): Promise<DocMeta> {
  // 指定 id：移动端同步新建文档时保持两端同 id（渲染层不传，走随机 UUID）
  const id = payload.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id)
    ? payload.id.toLowerCase()
    : randomUUID()
  const now = Date.now()
  const meta: DocMeta = {
    id,
    title: payload.title?.trim() || '未命名文档',
    tags: payload.tags ?? [],
    folder: payload.folder ?? '',
    createdAt: now,
    updatedAt: now
  }
  const dir = docDir(id)
  await fsp.mkdir(join(dir, 'assets'), { recursive: true })
  await fsp.mkdir(join(dir, 'history'), { recursive: true })
  await writeJsonAtomic(join(dir, 'meta.json'), meta)
  await writeJsonAtomic(join(dir, 'content.json'), payload.content ?? emptyDoc())
  await writeJsonAtomic(join(dir, 'layout.json'), await newDocLayout())
  return meta
}

async function listDocs(): Promise<DocMeta[]> {
  const dir = docsDir()
  let entries: string[] = []
  try {
    entries = await fsp.readdir(dir)
  } catch {
    return []
  }
  const metas: DocMeta[] = []
  for (const name of entries) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) continue
    try {
      const meta = await readMeta(name)
      if (meta.createdAt) metas.push(meta)
    } catch {
      /* 跳过损坏的文档目录 */
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

async function getDoc(id: string): Promise<DocBundle> {
  const dir = docDir(id)
  const meta = await readMeta(id)
  const content = await readContent(id)
  // 浅合并默认值，兼容旧版本 layout.json 缺少新字段
  const layout: DocLayout = { ...defaultLayout(), ...(await readJson<Partial<DocLayout>>(join(dir, 'layout.json'), {})) }
  return { meta, content, layout }
}

/** 文档写入回调：局域网手机端与 Syncthing 监视据此区分「本机写入」 */
const saveListeners = new Set<(docId: string, updatedAt: number) => void>()

export function onDocSaved(cb: (docId: string, updatedAt: number) => void): () => void {
  saveListeners.add(cb)
  return () => saveListeners.delete(cb)
}

async function saveDoc(id: string, payload: SaveDocPayload): Promise<SaveResult> {
  const dir = docDir(id)
  const now = Date.now()
  const prev = await readMeta(id)
  const meta: DocMeta = {
    ...prev,
    ...(payload.meta ?? {}),
    id,
    updatedAt: now
  }
  await writeJsonAtomic(join(dir, 'meta.json'), meta)
  if (payload.content) await writeJsonAtomic(join(dir, 'content.json'), payload.content)
  if (payload.layout) await writeJsonAtomic(join(dir, 'layout.json'), payload.layout)
  for (const cb of saveListeners) cb(id, now)
  return { savedAt: now, meta }
}

async function copyDoc(id: string): Promise<DocMeta> {
  const src = docDir(id)
  const newId = randomUUID()
  const dest = docDir(newId)
  await fsp.mkdir(dirname(dest), { recursive: true })
  await fsp.cp(src, dest, { recursive: true })
  const now = Date.now()
  const prev = await readMeta(id)
  const meta: DocMeta = {
    ...prev,
    id: newId,
    title: `${prev.title} 副本`,
    createdAt: now,
    updatedAt: now
  }
  await writeJsonAtomic(join(dest, 'meta.json'), meta)
  return meta
}

// ---------- 全文搜索 ----------

const textCache = new Map<string, { updatedAt: number; text: string }>()

async function docText(id: string, updatedAt: number): Promise<string> {
  const cached = textCache.get(id)
  if (cached && cached.updatedAt === updatedAt) return cached.text
  const content = await readJson<PMNode>(join(docDir(id), 'content.json'), emptyDoc())
  const text = pmToText(content)
  textCache.set(id, { updatedAt, text })
  return text
}

async function searchDocs(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const docs = await listDocs()
  const hits: SearchHit[] = []
  for (const meta of docs) {
    const inMeta =
      meta.title.toLowerCase().includes(q) ||
      meta.folder.toLowerCase().includes(q) ||
      meta.tags.some((t) => t.toLowerCase().includes(q))
    let snippet: string | undefined
    try {
      const text = await docText(meta.id, meta.updatedAt)
      const idx = text.toLowerCase().indexOf(q)
      if (idx >= 0) {
        const start = Math.max(0, idx - 30)
        snippet = `${start > 0 ? '…' : ''}${text.slice(start, idx + q.length + 40).replace(/\n/g, ' ')}…`
      } else if (inMeta) {
        snippet = text.slice(0, 60).replace(/\n/g, ' ')
      }
    } catch {
      /* 忽略读取失败 */
    }
    if (inMeta || snippet) hits.push({ meta, snippet })
  }
  return hits
}

// ---------- 文档库卡片 ----------

async function readLayout(id: string): Promise<DocLayout> {
  const partial = await readJson<Partial<DocLayout>>(join(docDir(id), 'layout.json'), {})
  const base = defaultLayout()
  return {
    ...base,
    ...partial,
    pageSetup: { ...base.pageSetup, ...(partial.pageSetup ?? {}) },
    typography: { ...base.typography, ...(partial.typography ?? {}) },
    splitRules: { ...base.splitRules, ...(partial.splitRules ?? {}) },
    backgrounds: { ...base.backgrounds, ...(partial.backgrounds ?? {}) }
  }
}

function nodeText(node: PMNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (!node.content) return ''
  return node.content.map(nodeText).join('')
}

function headingIsChapter(node: PMNode, rules: SplitRules): boolean {
  if (node.type !== 'heading') return false
  if (rules.h1 && node.attrs?.level === 1) return true
  if (rules.regex && rules.pattern) {
    try {
      if (new RegExp(rules.pattern).test(nodeText(node))) return true
    } catch {
      /* 非法正则按未命中处理 */
    }
  }
  return false
}

/** 与渲染进程 chaptersOf 同规则，但只读 JSON 且只取标题 */
function deriveChapters(content: PMNode, rules: SplitRules, docTitle: string): string[] {
  const titles: string[] = []
  const title = docTitle.trim()
  for (const block of content.content ?? []) {
    if (block.type === 'chapterBreak') {
      titles.push(String(block.attrs?.title || '未命名章节'))
    } else if (headingIsChapter(block, rules)) {
      const t = nodeText(block)
      // 与文档同名的标题只是篇名，不算章节
      if (t.trim() && t.trim() !== title) titles.push(t)
    }
  }
  return titles.slice(0, 200)
}

const SNIPPET_LEN = 220

/** 正文开头若干自然段（段间 \n），供卡片按需截断预览 */
function bodySnippet(text: string, title: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (lines.length > 1 && lines[0] === title.trim()) lines.shift()
  const body = lines.join('\n')
  return body.length > SNIPPET_LEN ? body.slice(0, SNIPPET_LEN) : body
}

async function listCards(): Promise<DocCardInfo[]> {
  const docs = await listDocs()
  const cards: DocCardInfo[] = []
  for (const meta of docs) {
    try {
      const content = await readJson<PMNode>(join(docDir(meta.id), 'content.json'), emptyDoc())
      const layout = await readLayout(meta.id)
      const text = await docText(meta.id, meta.updatedAt)
      const typo = layout.typography
      const ps = layout.pageSetup
      cards.push({
        meta,
        snippet: bodySnippet(text, meta.title),
        charCount: text.replace(/\s/g, '').length,
        bodyFont: typo.bodyFont,
        bodySize: typo.bodySize,
        bodyColor: typo.bodyColor,
        bodyLineHeight: typo.bodyLineHeight,
        headingFont: typo.headingFont,
        headingColor: typo.headingColor,
        h0Size: Math.round(typo.bodySize * h0ScaleOf(typo)),
        h1Size: Math.round(typo.bodySize * typo.h1Scale),
        h2Size: Math.round(typo.bodySize * typo.h2Scale),
        h3Size: Math.round(typo.bodySize * typo.h3Scale),
        quoteColor: typo.quoteColor,
        background: layout.backgrounds.global,
        widthMm: ps.widthMm,
        heightMm: ps.heightMm,
        infiniteHeight: ps.infiniteHeight === true,
        landscape: ps.landscape === true,
        marginsMm: { top: ps.marginTopMm, right: ps.marginRightMm, bottom: ps.marginBottomMm, left: ps.marginLeftMm },
        chapters: deriveChapters(content, layout.splitRules, meta.title)
      })
    } catch {
      /* 单个文档读取失败不影响列表 */
    }
  }
  return cards
}

// ---------- 文件夹 ----------

function foldersFile(): string {
  return join(getDataDir(), 'folders.json')
}

function normalizeFolder(path: string): string {
  return path
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/')
}

async function listFolders(): Promise<DocFolder[]> {
  const list = await readJson<DocFolder[]>(foldersFile(), [])
  return list.filter((f) => f && typeof f.path === 'string' && f.path)
}

async function createFolder(rawPath: string): Promise<DocFolder[]> {
  const path = normalizeFolder(rawPath ?? '')
  if (!path) throw new Error('文件夹名称不能为空')
  const list = await listFolders()
  if (!list.some((f) => f.path === path)) {
    list.push({ path, createdAt: Date.now() })
    await writeJsonAtomic(foldersFile(), list)
  }
  return list
}

async function removeFolder(rawPath: string): Promise<DocFolder[]> {
  const path = normalizeFolder(rawPath ?? '')
  const list = await listFolders()
  const docs = await listDocs()
  const hasDocs = docs.some((d) => {
    const p = normalizeFolder(d.folder)
    return p === path || p.startsWith(`${path}/`)
  })
  const hasChildren = list.some((f) => f.path.startsWith(`${path}/`))
  if (hasDocs || hasChildren) throw new Error('文件夹非空，无法删除')
  await writeJsonAtomic(
    foldersFile(),
    list.filter((f) => f.path !== path)
  )
  return listFolders()
}

// ---------- 导入 ----------

async function importFromPaths(paths: string[]): Promise<DocMeta[]> {
  const metas: DocMeta[] = []
  for (const p of paths) {
    const ext = extname(p).toLowerCase()
    let content: PMNode
    try {
      const raw = await fsp.readFile(p, 'utf8')
      if (ext === '.md' || ext === '.markdown') content = markdownToPM(raw)
      else if (ext === '.html' || ext === '.htm') content = htmlToPM(raw)
      else content = plainTextToPM(raw)
    } catch {
      continue
    }
    const meta = await createDoc({ title: basename(p, extname(p)), content })
    metas.push(meta)
  }
  return metas
}

// ---------- 资产 ----------

async function saveAssetBuffer(docId: string, name: string, buf: Buffer): Promise<ImportedAsset> {
  const dir = docDir(docId)
  const ext = (extname(name) || '.png').toLowerCase()
  const filename = `${randomUUID()}${ext}`
  const assetsDir = join(dir, 'assets')
  await fsp.mkdir(assetsDir, { recursive: true })
  await fsp.writeFile(join(assetsDir, filename), buf)
  return {
    name,
    relPath: `assets/${filename}`,
    url: `appres://${docId}/assets/${filename}`
  }
}

/** 预设自带资源：存 data/presets/assets，经 appres://preset/assets/<file> 读取，跨文档共用 */
async function writePresetAsset(filename: string, buf: Buffer): Promise<ImportedAsset> {
  const assetsDir = join(getDataDir(), 'presets', 'assets')
  await fsp.mkdir(assetsDir, { recursive: true })
  await fsp.writeFile(join(assetsDir, filename), buf)
  return {
    name: filename,
    relPath: `assets/${filename}`,
    url: `appres://preset/assets/${filename}`
  }
}

async function savePresetAssetBuffer(name: string, buf: Buffer): Promise<ImportedAsset> {
  const ext = (extname(name) || '.png').toLowerCase()
  return writePresetAsset(`${randomUUID()}${ext}`, buf)
}

/** 文档资源链接（appres://<uuid>/assets/<uuid>.<ext>）——预设只认这一种形状 */
const DOC_ASSET_URL_RE =
  /^appres:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8})$/i

/**
 * 把预设里指向某文档 assets 的图片改存为预设自带资源。
 * 否则「把当前文档背景存为预设」会永久依赖那篇文档，删文档即预设坏图。
 */
async function rehostAssetUrl(
  url: string | undefined,
  cache: Map<string, string>
): Promise<string | undefined> {
  if (!url) return url
  const hit = cache.get(url)
  if (hit) return hit
  const m = DOC_ASSET_URL_RE.exec(url)
  if (!m) return url
  let buf: Buffer
  try {
    buf = await fsp.readFile(join(getDataDir(), 'documents', m[1], m[2]))
  } catch {
    return url // 源文件已不存在：保留原链接，不破坏既有引用
  }
  const saved = await writePresetAsset(basename(m[2]), buf)
  cache.set(url, saved.url)
  return saved.url
}

async function rehostPresetBackground(
  bg: BackgroundSpec | null | undefined
): Promise<BackgroundSpec | null | undefined> {
  if (!bg) return bg
  const cache = new Map<string, string>()
  const next: BackgroundSpec = { ...bg }
  next.imageUrl = await rehostAssetUrl(bg.imageUrl, cache)
  next.textureUrl = await rehostAssetUrl(bg.textureUrl, cache)
  if (bg.multi) {
    next.multi = {
      ...bg.multi,
      topUrl: await rehostAssetUrl(bg.multi.topUrl, cache),
      midUrl: await rehostAssetUrl(bg.multi.midUrl, cache),
      bottomUrl: await rehostAssetUrl(bg.multi.bottomUrl, cache)
    }
  }
  return next
}

// ---------- 快照 ----------

function historyDir(id: string): string {
  return join(docDir(id), 'history')
}

async function listSnapshots(id: string): Promise<SnapshotInfo[]> {
  try {
    const files = await fsp.readdir(historyDir(id))
    const infos: SnapshotInfo[] = []
    for (const name of files) {
      if (!/^history-\d+\.json$/.test(name)) continue
      const stat = await fsp.stat(join(historyDir(id), name))
      const data = await readJson<Partial<SnapshotFile>>(join(historyDir(id), name), { savedAt: 0 })
      infos.push({ name, savedAt: data.savedAt || stat.mtimeMs, label: data.label, size: stat.size })
    }
    return infos.sort((a, b) => b.savedAt - a.savedAt)
  } catch {
    return []
  }
}

async function pruneSnapshots(id: string): Promise<void> {
  const settings = await readSettings()
  const infos = await listSnapshots(id)
  const excess = infos.slice(settings.maxSnapshots)
  for (const info of excess) {
    await fsp.rm(join(historyDir(id), info.name), { force: true })
  }
}

async function readSettings(): Promise<Settings> {
  return readJson<Settings>(settingsFile(), defaultSettings())
}

async function writeSettingsFile(data: Settings): Promise<void> {
  await writeJsonAtomic(settingsFile(), data)
}

// ---------- IPC 注册 ----------

export function registerStorageIpc(): void {
  ipcMain.handle('settings:get', () => readSettings())

  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    const merged = { ...(await readSettings()), ...patch }
    await writeSettingsFile(merged)
    return merged
  })

  ipcMain.handle('docs:list', async () => {
    await migrateWelcomeDocOnce()
    const docs = await listDocs()
    // 首次运行播种欢迎文档
    const settings = await readSettings()
    if (!settings.seeded && docs.length === 0) {
      await createDoc({ title: '欢迎使用文转条图', content: welcomeDoc() })
      await writeJsonAtomic(settingsFile(), { ...settings, seeded: true })
      return listDocs()
    }
    return docs
  })

  ipcMain.handle('docs:get', (_e, id: string) => getDoc(id))

  ipcMain.handle('docs:cards', () => listCards())

  ipcMain.handle('folders:list', () => listFolders())

  ipcMain.handle('folders:create', (_e, path: string) => createFolder(path))

  ipcMain.handle('folders:remove', (_e, path: string) => removeFolder(path))

  ipcMain.handle('docs:create', (_e, payload: CreateDocPayload) => createDoc(payload ?? {}))

  ipcMain.handle('docs:save', (_e, id: string, payload: SaveDocPayload) => saveDoc(id, payload))

  ipcMain.handle('docs:copy', (_e, id: string) => copyDoc(id))

  ipcMain.handle('docs:remove', async (_e, id: string) => {
    await fsp.rm(docDir(id), { recursive: true, force: true })
    textCache.delete(id)
  })

  ipcMain.handle(
    'docs:updateMeta',
    (_e, id: string, patch: Partial<Pick<DocMeta, 'title' | 'tags' | 'folder'>>) =>
      saveDoc(id, { meta: patch as DocMeta }).then((r) => r.meta)
  )

  ipcMain.handle('docs:search', (_e, query: string) => searchDocs(query))

  ipcMain.handle('docs:importFromPaths', (_e, paths: string[]) => importFromPaths(paths))

  ipcMain.handle('assets:import', async (_e, docId: string, paths: string[]) => {
    const out: ImportedAsset[] = []
    for (const p of paths) {
      try {
        const buf = await fsp.readFile(p)
        out.push(await saveAssetBuffer(docId, basename(p), buf))
      } catch {
        /* 跳过读取失败的文件 */
      }
    }
    return out
  })

  /** 预设编辑里选图：落到 data/presets/assets，不依赖任何文档 */
  ipcMain.handle('assets:importPreset', async (_e, paths: string[]) => {
    const out: ImportedAsset[] = []
    for (const p of paths) {
      try {
        const buf = await fsp.readFile(p)
        out.push(await savePresetAssetBuffer(basename(p), buf))
      } catch {
        /* 跳过读取失败的文件 */
      }
    }
    return out
  })

  ipcMain.handle('assets:saveData', (_e, docId: string, name: string, base64: string) => {
    const buf = Buffer.from(base64, 'base64')
    return saveAssetBuffer(docId, name || 'image.png', buf)
  })

  ipcMain.handle('snapshots:list', (_e, docId: string) => listSnapshots(docId))

  ipcMain.handle('snapshots:create', async (_e, docId: string, payload?: { label?: string }) => {
    const dir = docDir(docId)
    const savedAt = Date.now()
    const content = await readContent(docId)
    const layout = await readJson<DocLayout>(join(dir, 'layout.json'), defaultLayout())
    const name = `history-${savedAt}.json`
    const file: SnapshotFile = { savedAt, label: payload?.label, content, layout }
    await fsp.mkdir(historyDir(docId), { recursive: true })
    await writeJsonAtomic(join(historyDir(docId), name), file)
    await pruneSnapshots(docId)
    return { name, savedAt, label: payload?.label, size: JSON.stringify(file).length }
  })

  ipcMain.handle('snapshots:get', async (_e, docId: string, name: string) => {
    if (!/^history-\d+\.json$/.test(name)) throw new Error(`非法快照名: ${name}`)
    const snap = await readJson<SnapshotData>(join(historyDir(docId), name), {
      savedAt: 0,
      content: emptyDoc(),
      layout: defaultLayout()
    })
    return { ...snap, content: { ...snap.content, content: (snap.content.content ?? []).flatMap(stripCodeBlocks) } }
  })

  ipcMain.handle('snapshots:remove', async (_e, docId: string, name: string) => {
    if (!/^history-\d+\.json$/.test(name)) throw new Error(`非法快照名: ${name}`)
    await fsp.rm(join(historyDir(docId), name), { force: true })
    return listSnapshots(docId)
  })

  ipcMain.handle(
    'dialog:openFile',
    async (_e, options: FileDialogOptions) => {
      const r = await dialog.showOpenDialog({
        title: options?.title,
        filters: options?.filters,
        properties: options?.multi ? ['openFile', 'multiSelections'] : ['openFile']
      })
      return r.canceled ? [] : r.filePaths
    }
  )

  ipcMain.handle('dialog:openDirectory', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:saveFile', async (_e, options: SaveFileDialogOptions) => {
    const r = await dialog.showSaveDialog({
      title: options?.title,
      defaultPath: options?.defaultName,
      filters: options?.filters
    })
    return r.canceled ? null : r.filePath ?? null
  })

  ipcMain.handle('presets:list', () => readPresets())

  ipcMain.handle('presets:save', async (_e, preset: Preset) => {
    const list = readPresetsSync()
    const now = Date.now()
    const idx = list.findIndex((p) => p.id === preset.id)
    const data: Preset['data'] = preset.data
      ? { ...preset.data, background: await rehostPresetBackground(preset.data.background) }
      : preset.data
    const merged: Preset = { ...preset, updatedAt: now, data }
    if (idx >= 0) list[idx] = merged
    else list.push(merged)
    return writePresets(list)
  })

  ipcMain.handle('presets:remove', (_e, id: string) =>
    writePresets(readPresetsSync().filter((p) => p.id !== id))
  )

  ipcMain.handle('presets:importFromPaths', async (_e, paths: string[]) => {
    const list = readPresetsSync()
    for (const p of paths) {
      try {
        const imported = JSON.parse(await fsp.readFile(p, 'utf8')) as Preset | Preset[]
        for (const preset of Array.isArray(imported) ? imported : [imported]) {
          if (!preset.id || !preset.kind) continue
          const idx = list.findIndex((x) => x.id === preset.id)
          if (idx >= 0) list[idx] = preset
          else list.push(preset)
        }
      } catch {
        /* 跳过无法解析的文件 */
      }
    }
    return writePresets(list)
  })

  ipcMain.handle('presets:exportToPath', (_e, path: string, ids: string[]) => {
    const list = readPresetsSync().filter((p) => ids.includes(p.id))
    return writeJsonAtomic(path, list)
  })

  ipcMain.handle('app:info', (): AppInfo => {
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      dataDir: getDataDir()
    }
  })
}

/** 供局域网手机端服务（mobile.ts）复用的存储入口 */
export const docStore = {
  listDocs,
  getDoc,
  saveDoc,
  createDoc,
  readSettings,
  writeSettingsFile
}
