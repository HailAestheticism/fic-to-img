import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { DocCardInfo, DocFolder, DocMeta } from '@shared/types'
import { api } from '../api'

export type LibraryViewKind = 'browse' | 'tree' | 'mind'

/** 排序方式：展柜 / 目录树 / 思维导图共用 */
export type SortMode = 'updated-desc' | 'name-asc' | 'name-desc' | 'created-asc' | 'created-desc'

export const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: 'updated-desc', label: '最后编辑 · 新→旧' },
  { key: 'name-asc', label: '名称 ↑' },
  { key: 'name-desc', label: '名称 ↓' },
  { key: 'created-asc', label: '建立时间 ↑' },
  { key: 'created-desc', label: '建立时间 ↓' }
]

/** 目录树节点：文件夹可嵌套，文档是叶子 */
export interface FolderNode {
  path: string
  name: string
  children: FolderNode[]
  docs: DocMeta[]
  /** 文件夹建立时间（空文件夹取登记时间） */
  createdAt: number
  /** 含子级在内的最后编辑时间 */
  updatedAt: number
}

const VIEW_KEY = 'fictoimg.library.view'
const START_VIEW_KEY = 'fictoimg.library.startView'
const SORT_KEY = 'fictoimg.library.sort'

function splitFolder(folder: string): string[] {
  return folder
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function normalizeFolder(folder: string): string {
  return splitFolder(folder).join('/')
}

function readStartView(): LibraryViewKind {
  const stored = (localStorage.getItem(START_VIEW_KEY) || 'browse') as LibraryViewKind
  return stored === 'browse' || stored === 'tree' || stored === 'mind' ? stored : 'browse'
}

function readView(): LibraryViewKind {
  const legacy = localStorage.getItem(VIEW_KEY)
  if (legacy === 'card') return 'browse'
  const stored = (legacy || readStartView()) as LibraryViewKind
  return stored === 'browse' || stored === 'tree' || stored === 'mind' ? stored : 'browse'
}

function emptyCard(meta: DocMeta): DocCardInfo {
  return {
    meta,
    snippet: '',
    charCount: 0,
    bodyFont: '',
    bodySize: 16,
    bodyColor: '#2f2a26',
    bodyLineHeight: '1.9',
    headingFont: '',
    headingColor: '#2f2a26',
    h0Size: 35,
    h1Size: 27,
    h2Size: 22,
    h3Size: 19,
    quoteColor: '#5c554d',
    background: null,
    widthMm: 210,
    heightMm: 297,
    infiniteHeight: false,
    landscape: false,
    marginsMm: { top: 22, right: 18, bottom: 22, left: 18 },
    chapters: []
  }
}

/** 比较器：作用于文件夹与文档的混合列表 */
function makeComparator(mode: SortMode, nameOf: (v: DocMeta | FolderNode) => string, createdOf: (v: DocMeta | FolderNode) => number, updatedOf: (v: DocMeta | FolderNode) => number) {
  return (a: DocMeta | FolderNode, b: DocMeta | FolderNode): number => {
    switch (mode) {
      case 'name-asc':
        return nameOf(a).localeCompare(nameOf(b), 'zh-Hans-CN')
      case 'name-desc':
        return nameOf(b).localeCompare(nameOf(a), 'zh-Hans-CN')
      case 'created-asc':
        return createdOf(a) - createdOf(b)
      case 'created-desc':
        return createdOf(b) - createdOf(a)
      default:
        return updatedOf(b) - updatedOf(a)
    }
  }
}

export const useLibraryStore = defineStore('library', () => {
  const docs = ref<DocMeta[]>([])
  const cards = ref<DocCardInfo[]>([])
  const folders = ref<DocFolder[]>([])
  const loading = ref(false)
  const query = ref('')
  const contentSearch = ref(false)
  const activeTags = ref<string[]>([])
  const hits = ref<Record<string, string>>({})
  const view = ref<LibraryViewKind>(readView())
  const startView = ref<LibraryViewKind>(readStartView())
  const sortMode = ref<SortMode>((localStorage.getItem(SORT_KEY) as SortMode) || 'updated-desc')
  /** 展柜当前浏览路径（面包屑），空数组 = 总文档库 */
  const browsePath = ref<string[]>([])

  watch(view, (v) => localStorage.setItem(VIEW_KEY, v))
  watch(sortMode, (v) => localStorage.setItem(SORT_KEY, v))
  watch(startView, (v) => localStorage.setItem(START_VIEW_KEY, v))

  const cardById = computed<Record<string, DocCardInfo>>(() => {
    const map: Record<string, DocCardInfo> = {}
    for (const c of cards.value) map[c.meta.id] = c
    return map
  })

  /** 已登记 + 文档实际用到的全部文件夹路径 */
  const allFolderPaths = computed<string[]>(() => {
    const set = new Set<string>(folders.value.map((f) => f.path))
    for (const d of docs.value) {
      const parts = splitFolder(d.folder)
      let acc = ''
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p
        set.add(acc)
      }
    }
    return Array.from(set).sort()
  })

  const folderCreatedAt = computed<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const f of folders.value) map[f.path] = f.createdAt
    return map
  })

  const allTags = computed(() => Array.from(new Set(docs.value.flatMap((d) => d.tags))).sort())

  /** 关键词 / 标签 / 全文命中过滤后的文档（未排序） */
  const filtered = computed<DocMeta[]>(() => {
    let list = docs.value
    const q = query.value.trim().toLowerCase()
    if (q) {
      const matched = list.filter(
        (d) =>
          d.title.toLowerCase().includes(q) ||
          d.folder.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q)) ||
          hits.value[d.id] !== undefined
      )
      const ids = new Set(matched.map((d) => d.id))
      for (const hitId of Object.keys(hits.value)) {
        if (!ids.has(hitId)) {
          const doc = list.find((d) => d.id === hitId)
          if (doc) matched.push(doc)
        }
      }
      list = matched
    }
    if (activeTags.value.length) {
      list = list.filter((d) => activeTags.value.every((t) => d.tags.includes(t)))
    }
    return list
  })

  /** 当前筛选结果对应的卡片 */
  const filteredCards = computed<DocCardInfo[]>(() =>
    filtered.value.map((meta) => cardById.value[meta.id] ?? emptyCard(meta))
  )

  /** 展柜路径前缀（查询非空时忽略路径，全库平铺展示） */
  const browsePrefix = computed(() => browsePath.value.join('/'))

  const searching = computed(() => query.value.trim().length > 0)

  /** 展柜当前目录下的文档卡片 */
  const browseCards = computed<DocCardInfo[]>(() => {
    const list = filtered.value.filter((d) =>
      searching.value ? true : normalizeFolder(d.folder) === browsePrefix.value
    )
    const cmp = makeComparator(
      sortMode.value,
      (v) => (v as DocMeta).title ?? (v as FolderNode).name,
      (v) => (v as DocMeta).createdAt ?? (v as FolderNode).createdAt,
      (v) => (v as DocMeta).updatedAt ?? (v as FolderNode).updatedAt
    )
    return [...list].sort(cmp).map((m) => cardById.value[m.id] ?? emptyCard(m))
  })

  /** 展柜当前目录下的子文件夹 */
  const browseFolders = computed<FolderNode[]>(() => {
    const nodes = tree.value
    const walk = (list: FolderNode[], path: string[]): FolderNode[] => {
      if (!path.length) return list
      const hit = list.find((n) => n.name === path[0])
      return hit ? walk(hit.children, path.slice(1)) : []
    }
    const list = searching.value ? [] : walk(nodes, browsePath.value)
    const cmp = makeComparator(
      sortMode.value,
      (v) => (v as FolderNode).name,
      (v) => (v as FolderNode).createdAt,
      (v) => (v as FolderNode).updatedAt
    )
    return [...list].sort(cmp)
  })

  /** 完整的库层级树（含空文件夹与根级散文档） */
  const tree = computed<FolderNode[]>(() => buildTree(filteredCards.value, allFolderPaths.value, folderCreatedAt.value, sortMode.value))

  /** 未归类（未分文件夹）文档，思维导图浮动卡片用 */
  const looseCards = computed<DocCardInfo[]>(() =>
    filteredCards.value.filter((c) => !splitFolder(c.meta.folder).length)
  )

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      const metas = await api.docs.list()
      docs.value = metas
      try {
        cards.value = await api.docs.cards()
      } catch {
        cards.value = []
      }
      try {
        folders.value = await api.folders.list()
      } catch {
        folders.value = []
      }
    } finally {
      loading.value = false
    }
  }

  async function runSearch(): Promise<void> {
    if (contentSearch.value && query.value.trim().length > 1) {
      const res = await api.docs.search(query.value.trim())
      hits.value = Object.fromEntries(res.map((h) => [h.meta.id, h.snippet ?? '']))
    } else {
      hits.value = {}
    }
  }

  async function createDoc(payload?: { title?: string; folder?: string; tags?: string[] }): Promise<DocMeta> {
    const meta = await api.docs.create(payload ?? {})
    await refresh()
    return meta
  }

  /** 在展柜当前目录下新建文件夹 */
  async function createFolder(name: string): Promise<void> {
    const path = [...browsePath.value, ...splitFolder(name)].join('/')
    folders.value = await api.folders.create(path)
    await refresh()
  }

  async function removeFolder(path: string): Promise<void> {
    folders.value = await api.folders.remove(path)
    await refresh()
  }

  async function copyDoc(id: string): Promise<void> {
    await api.docs.copy(id)
    await refresh()
  }

  async function removeDoc(id: string): Promise<void> {
    await api.docs.remove(id)
    await refresh()
  }

  async function updateMeta(
    id: string,
    patch: Partial<Pick<DocMeta, 'title' | 'tags' | 'folder'>>
  ): Promise<void> {
    await api.docs.updateMeta(id, patch)
    await refresh()
  }

  async function importDocs(paths: string[]): Promise<number> {
    const metas = await api.docs.importFromPaths(paths)
    await refresh()
    return metas.length
  }

  return {
    docs,
    cards,
    folders,
    loading,
    query,
    contentSearch,
    activeTags,
    hits,
    view,
    startView,
    sortMode,
    browsePath,
    searching,
    cardById,
    foldersList: allFolderPaths,
    allTags,
    filtered,
    filteredCards,
    browseCards,
    browseFolders,
    looseCards,
    tree,
    refresh,
    runSearch,
    createDoc,
    createFolder,
    removeFolder,
    copyDoc,
    removeDoc,
    updateMeta,
    importDocs
  }
})

/** 由文档 + 已登记文件夹构建目录树，docs/children 按 sortMode 排序 */
function buildTree(
  cards: DocCardInfo[],
  knownFolders: string[],
  createdAtMap: Record<string, number>,
  sortMode: SortMode
): FolderNode[] {
  const roots: FolderNode[] = []
  const index = new Map<string, FolderNode>()
  const ensure = (parts: string[]): FolderNode => {
    let level = roots
    let acc = ''
    let node: FolderNode | null = null
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      node = index.get(acc) ?? null
      if (!node) {
        node = { path: acc, name: part, children: [], docs: [], createdAt: 0, updatedAt: 0 }
        node.createdAt = createdAtMap[acc] ?? Date.now()
        index.set(acc, node)
        level.push(node)
      }
      level = node.children
    }
    return node as FolderNode
  }

  const loose: DocMeta[] = []
  for (const c of cards) {
    const parts = splitFolder(c.meta.folder)
    if (!parts.length) {
      loose.push(c.meta)
      continue
    }
    ensure(parts).docs.push(c.meta)
  }
  for (const p of knownFolders) ensure(splitFolder(p))

  const cmp = makeComparator(
    sortMode,
    (v) => (v as DocMeta).title ?? (v as FolderNode).name,
    (v) => (v as DocMeta).createdAt ?? (v as FolderNode).createdAt,
    (v) => (v as DocMeta).updatedAt ?? (v as FolderNode).updatedAt
  )

  const finalize = (nodes: FolderNode[]): number => {
    let updated = 0
    for (const n of nodes) {
      const childUpdated = finalize(n.children)
      const docUpdated = n.docs.reduce((m, d) => Math.max(m, d.updatedAt), 0)
      n.updatedAt = Math.max(childUpdated, docUpdated) || n.createdAt
      n.docs.sort(cmp as (a: DocMeta, b: DocMeta) => number)
    }
    nodes.sort(cmp)
    for (const n of nodes) updated = Math.max(updated, n.updatedAt)
    return updated
  }
  finalize(roots)
  // 未归类文档不进入树：各视图以浮动/平铺卡片单独呈现
  void loose
  return roots
}
