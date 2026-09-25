import { defineStore } from 'pinia'
import { ref, toRaw } from 'vue'
import type { DocBundle, DocLayout, DocMeta, MobileChangedEvent, PMNode, Settings, SnapshotInfo } from '@shared/types'
import { api } from '../api'

/** 统一撤销时间线上的一步：只保存本次真正改动字段的旧值 */
type HistoryStep = {
  tag: string
  content?: PMNode
  layout?: DocLayout
}

export const useDocStore = defineStore('doc', () => {
  const id = ref('')
  const meta = ref<DocMeta | null>(null)
  const content = ref<PMNode | null>(null)
  const layout = ref<DocLayout | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const saveState = ref<'saved' | 'dirty' | 'saving' | 'error'>('saved')
  const lastSavedAt = ref(0)
  const snapshots = ref<SnapshotInfo[]>([])
  const settings = ref<Settings | null>(null)
  /** 编辑器只在创建时读取 initial，恢复快照需要换 key 触发重建 */
  const contentRev = ref(0)
  /** 手机端 / Syncthing 带来的改动：本地有未保存内容时先挂起，等用户决定 */
  const remoteChange = ref<MobileChangedEvent | null>(null)

  /** 正文与画布共用的一条时间线：一步 = 某次改动之前的「正文 / 布局」旧值 */
  const HISTORY_LIMIT = 60
  /** 同一次连续操作（拖滑块、改透明度、打字）在 700ms 内合并为一步 */
  const COALESCE_MS = 700
  /** 合并的兜底上限：再连续的同类操作每 2.5s 也切一刀，撤销不至于一次吞掉整段 */
  const GROUP_MAX_MS = 2500

  const undoStack: HistoryStep[] = []
  const redoStack: HistoryStep[] = []
  let lastTag = ''
  let lastAt = 0
  let groupStart = 0
  const canUndo = ref(false)
  const canRedo = ref(false)

  function syncHistoryFlags(): void {
    canUndo.value = undoStack.length > 0
    canRedo.value = redoStack.length > 0
  }

  function cloneJson<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T
  }

  /** 正文取引用即可（编辑器每轮改动都给全新的 JSON），布局可能被就地改嵌套字段，故深拷贝 */
  function oldContent(): PMNode | undefined {
    return content.value ? (toRaw(content.value) as PMNode) : undefined
  }

  function oldLayout(): DocLayout | undefined {
    return layout.value ? cloneJson(layout.value) : undefined
  }

  /**
   * 记一步撤销：只记下本次真正改动字段的旧值。
   * tag 相同且在窗口内的连续操作合并成一步（撤销一次即回到整段操作之前）。
   */
  function pushHistory(kind: 'content' | 'layout', tag: string): void {
    if (status.value !== 'ready') return
    const now = Date.now()
    const head = undoStack[undoStack.length - 1]
    const coalesce =
      tag !== '' &&
      head !== undefined &&
      tag === lastTag &&
      now - lastAt < COALESCE_MS &&
      now - groupStart < GROUP_MAX_MS
    lastTag = tag
    lastAt = now
    if (coalesce && head) {
      // 组内这个字段第一次变化：旧值要补进本组开头那一步
      if (kind === 'content' && head.content === undefined) head.content = oldContent()
      if (kind === 'layout' && head.layout === undefined) head.layout = oldLayout()
      return
    }
    groupStart = now
    const step: HistoryStep = { tag }
    if (kind === 'content') step.content = oldContent()
    else step.layout = oldLayout()
    undoStack.push(step)
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
    redoStack.length = 0
    syncHistoryFlags()
  }

  /** 结束当前合并组（提交块编辑、切图层等）：下一次操作另起一步 */
  function breakHistoryGroup(): void {
    lastTag = ''
    lastAt = 0
    groupStart = 0
  }

  /** 走一步：把 step 的旧值装回去，并把它替换下来的现值记到对面的栈上 */
  function moveHistory(from: HistoryStep[], to: HistoryStep[]): boolean {
    const step = from.pop()
    if (!step) return false
    const back: HistoryStep = { tag: step.tag }
    if (step.content !== undefined) {
      back.content = oldContent()
      content.value = step.content
    }
    if (step.layout !== undefined) {
      back.layout = oldLayout()
      layout.value = step.layout
    }
    to.push(back)
    breakHistoryGroup()
    markDirty()
    syncHistoryFlags()
    return true
  }

  function undo(): boolean {
    return moveHistory(undoStack, redoStack)
  }

  function redo(): boolean {
    return moveHistory(redoStack, undoStack)
  }

  function resetHistory(): void {
    undoStack.length = 0
    redoStack.length = 0
    breakHistoryGroup()
    syncHistoryFlags()
  }

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let snapTimer: ReturnType<typeof setInterval> | undefined
  let lastSnapContent = ''

  async function open(docId: string): Promise<void> {
    dispose()
    status.value = 'loading'
    try {
      settings.value = await api.settings.get()
      const bundle: DocBundle = await api.docs.get(docId)
      id.value = docId
      meta.value = bundle.meta
      content.value = bundle.content
      layout.value = bundle.layout
      status.value = 'ready'
      saveState.value = 'saved'
      lastSavedAt.value = bundle.meta.updatedAt
      lastSnapContent = JSON.stringify(bundle.content)
      resetHistory()
      await refreshSnapshots()
      const mins = settings.value.snapshotIntervalMinutes
      if (mins > 0) snapTimer = setInterval(() => void autoSnapshot(), mins * 60_000)
    } catch (e) {
      status.value = 'error'
      throw e
    }
  }

  function patchContent(json: PMNode, tag = 'text'): void {
    if (!content.value) return
    pushHistory('content', tag)
    content.value = json
    markDirty()
  }

  function patchMeta(patch: Partial<DocMeta>): void {
    if (!meta.value) return
    meta.value = { ...meta.value, ...patch }
    markDirty()
  }

  function patchLayout(patch: Partial<DocLayout>, tag = ''): void {
    if (!layout.value) return
    const next: DocLayout = { ...layout.value, ...patch }
    // 值没变就什么也不做：自动回写（如画布同步）不该占用一步撤销
    if (JSON.stringify(layout.value) === JSON.stringify(next)) return
    pushHistory('layout', tag)
    layout.value = next
    markDirty()
  }

  function markDirty(): void {
    saveState.value = 'dirty'
    scheduleSave()
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void save(), 1500)
  }

  async function save(): Promise<void> {
    if (!id.value || !meta.value || saveState.value !== 'dirty') return
    saveState.value = 'saving'
    try {
      const r = await api.docs.save(id.value, {
        meta: meta.value,
        content: content.value ?? undefined,
        layout: layout.value ?? undefined
      })
      meta.value = r.meta
      saveState.value = 'saved'
      lastSavedAt.value = r.savedAt
    } catch (e) {
      console.error('[doc] 保存失败:', e)
      saveState.value = 'error'
    }
  }

  async function flush(): Promise<void> {
    if (saveState.value === 'dirty') {
      clearTimeout(saveTimer)
      await save()
    }
  }

  async function refreshSnapshots(): Promise<void> {
    if (id.value) snapshots.value = await api.snapshots.list(id.value)
  }

  async function createSnapshot(label?: string): Promise<void> {
    await flush()
    if (!id.value) return
    await api.snapshots.create(id.value, { label })
    lastSnapContent = JSON.stringify(content.value)
    await refreshSnapshots()
  }

  async function restoreSnapshot(name: string): Promise<void> {
    const snap = await api.snapshots.get(id.value, name)
    content.value = snap.content
    layout.value = snap.layout
    saveState.value = 'dirty'
    await save()
    lastSnapContent = JSON.stringify(content.value)
    resetHistory()
    contentRev.value++
  }

  async function deleteSnapshot(name: string): Promise<void> {
    if (!id.value) return
    snapshots.value = await api.snapshots.remove(id.value, name)
  }

  async function autoSnapshot(): Promise<void> {
    if (!id.value) return
    await flush()
    const cur = JSON.stringify(content.value)
    if (cur === lastSnapContent) return
    await createSnapshot('自动快照')
  }

  async function reloadFromDisk(): Promise<void> {
    if (!id.value) return
    const bundle = await api.docs.get(id.value)
    content.value = bundle.content
    meta.value = bundle.meta
    lastSavedAt.value = bundle.meta.updatedAt
    lastSnapContent = JSON.stringify(bundle.content)
    breakHistoryGroup()
    contentRev.value++
  }

  async function onRemoteChanged(e: MobileChangedEvent): Promise<void> {
    if (!id.value || e.docId !== id.value) return
    if (saveState.value === 'saved') await reloadFromDisk()
    else remoteChange.value = e
  }

  async function acceptRemote(): Promise<void> {
    await reloadFromDisk()
    remoteChange.value = null
  }

  function dismissRemote(): void {
    remoteChange.value = null
  }

  function dispose(): void {
    clearTimeout(saveTimer)
    clearInterval(snapTimer)
    saveTimer = undefined
    snapTimer = undefined
    remoteChange.value = null
    id.value = ''
    meta.value = null
    content.value = null
    layout.value = null
    status.value = 'idle'
    saveState.value = 'saved'
    snapshots.value = []
    resetHistory()
  }

  return {
    id,
    meta,
    content,
    layout,
    status,
    saveState,
    lastSavedAt,
    snapshots,
    settings,
    contentRev,
    remoteChange,
    canUndo,
    canRedo,
    undo,
    redo,
    resetHistory,
    breakHistoryGroup,
    open,
    onRemoteChanged,
    acceptRemote,
    dismissRemote,
    patchContent,
    patchMeta,
    patchLayout,
    save,
    flush,
    refreshSnapshots,
    createSnapshot,
    restoreSnapshot,
    deleteSnapshot,
    dispose
  }
})
