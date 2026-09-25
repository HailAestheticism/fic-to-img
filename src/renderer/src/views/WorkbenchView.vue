<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { ActivePageInfo, LayoutLayer, PageSetup, PMNode as PMJson, SplitRules, WorkbenchMode } from '@shared/types'
import { useAppStore } from '../stores/app'
import { useDocStore } from '../stores/doc'
import { useWorkbenchShortcuts } from '../composables/useShortcuts'
import { ZOOM_STEP_WHEEL, useZoom } from '../composables/zoom'
import { chaptersOf, ensureChapterIds, jumpToPos } from '../editor/chapters'
import type { ChapterItem } from '../editor/chapters'
import { isDocTitle } from '../editor/doc-title'
import RichEditor from '../editor/RichEditor.vue'
import EditorToolbar from '../editor/EditorToolbar.vue'
import ChapterSidebar from '../components/workbench/ChapterSidebar.vue'
import CollapseCard from '../components/common/CollapseCard.vue'
import PagedView from '../pager/PagedView.vue'
import { mmToPx } from '../pager/paginate'
import LayerPanel from '../components/workbench/LayerPanel.vue'
import LayerSwitch from '../components/workbench/LayerSwitch.vue'
import MixedTextPanel from '../components/workbench/MixedTextPanel.vue'
import PageSetupPanel from '../components/workbench/PageSetupPanel.vue'
import PresetPanel from '../components/workbench/PresetPanel.vue'
import SnapshotDialog from '../components/workbench/SnapshotDialog.vue'
import ZoomControls from '../components/workbench/ZoomControls.vue'
import type { ElementScope } from '../freelay/fabric-service'
import { applyTypoVars } from '../presets/preset-service'
import type { Typography } from '@shared/types'

const app = useAppStore()
const doc = useDocStore()

const showSnaps = ref(false)
const sidebarOpen = ref(true)
const showRules = ref(false)

const sidebarSide = computed<'left' | 'right'>(() => doc.settings?.sidebarSide ?? 'left')

/** 画布横向 = 全局竖排。写作界面按横向页版心高定列高（短边 − 上下边距），正文向右无限延展 */
const vertDoc = computed(() => doc.layout?.pageSetup?.landscape === true)
const vertDocStyle = computed<Record<string, string | undefined>>(() => {
  const ps = doc.layout?.pageSetup
  if (!ps || !vertDoc.value) return {}
  return { '--vert-doc-h': `${mmToPx(ps.widthMm - ps.marginTopMm - ps.marginBottomMm)}px` }
})

useWorkbenchShortcuts({ onSnapshot: () => (showSnaps.value = true) })

// ---------- 界面缩放（阶段 24）：写作/排版/混合/预览共用，仅存活于本次运行 ----------

const zoom = useZoom()

/** 右下角缩放控件让开右侧面板：排版/混合有 292px 工具侧栏（+1px 边框），写作居右展开时有章节栏 */
const zoomDockRight = computed(() => {
  let r = 18
  if (app.mode === 'layout' || app.mode === 'mixed') r += 293
  else if (app.mode === 'write' && sidebarSide.value === 'right' && sidebarOpen.value) r += 251
  return `${r}px`
})

/** Ctrl+滚轮上/下 = 放大/缩小一格（5%）；吞掉 Chromium 默认的整页缩放 */
function onBodyWheel(e: WheelEvent): void {
  if (!e.ctrlKey) return
  e.preventDefault()
  if (e.deltaY === 0) return
  zoom.stepZoom(e.deltaY < 0 ? ZOOM_STEP_WHEEL : -ZOOM_STEP_WHEEL)
}

/**
 * 规则 3：切换/解除画布横向、更换画布尺寸（含套画布预设与手改宽高）后重置缩放。
 * 字符串签名只对这几项敏感——页边距等其它页面设置改动不触发；首次载入（旧值为空）不触发。
 */
watch(
  () => {
    const ps = doc.layout?.pageSetup
    if (!ps) return ''
    return `${ps.landscape}|${ps.widthMm}|${ps.heightMm ?? ''}|${ps.infiniteHeight}`
  },
  (v, old) => {
    if (old && v !== old) zoom.resetZoom()
  }
)

const pagedRef = ref<InstanceType<typeof PagedView>>()
const editLayer = ref<LayoutLayer>('bg')
const activePageInfo = ref<ActivePageInfo | null>(null)
const hasSelection = ref(false)

// ---------- 混合界面：单画布 + 三图层（最顶层 / 文本层 / 背景层） ----------

type MixedLayer = 'top' | 'text' | 'bg'

const MIXED_LAYERS: { v: MixedLayer; t: string; s: string }[] = [
  { v: 'top', t: '最顶层', s: '覆盖文字' },
  { v: 'text', t: '文本层', s: '点击改字' },
  { v: 'bg', t: '背景层', s: '文字之下' }
]

const mixedPagedRef = ref<InstanceType<typeof PagedView>>()
const mixedLayer = ref<MixedLayer>('text')
/** 页内就地编辑的块编辑器（未编辑时为 undefined → 侧栏文本功能全部置灰） */
const mixedEd = shallowRef<Editor>()
const mixedBlockKey = ref('')
const mixedFirstBlock = ref(false)
/** 就地编辑块在正文中的位置：-1 = 未编辑（章节符只能插在选中的块之前） */
const mixedBlockPos = ref(-1)
/** 章节列表与当前章节都由分页画布供给（混合界面没有写作模式的 RichEditor） */
const mixedChapters = ref<ChapterItem[]>([])
const mixedVisibleChapter = ref('')

// ---------- 侧栏折叠卡片（阶段 35）：页面设置 / 预设默认收起 ----------

const setupOpen = ref(false)
const presetOpen = ref(false)
const appliedPresetName = ref('')

/** 收起时居右摘要：当前画布的显示宽×高（横向排版宽高互换取 mm；无限边显示「无限」） */
const canvasHint = computed(() => {
  const ps = doc.layout?.pageSetup
  if (!ps) return ''
  const r = (v: number): number => Math.round(v * 100) / 100
  const land = ps.landscape === true
  const w = land ? ps.heightMm : ps.widthMm
  const h = land ? ps.widthMm : ps.heightMm
  if (ps.infiniteHeight) return land ? `无限×${r(h)}mm` : `${r(w)}×无限mm`
  return `${r(w)}×${r(h)}mm`
})

/** 每次进入排版/混合界面、每次切换图层：两张卡片都重置为收起 */
watch([() => app.mode, editLayer, mixedLayer], () => {
  setupOpen.value = false
  presetOpen.value = false
})

watch(
  () => doc.id,
  () => (appliedPresetName.value = '')
)

const mixedActiveChapter = computed(
  () =>
    mixedVisibleChapter.value ||
    activePageInfo.value?.chapterId ||
    mixedChapters.value[0]?.chapterId ||
    ''
)

function onMixedVisiblePage(info: ActivePageInfo | null): void {
  mixedVisibleChapter.value = info?.chapterId ?? ''
}

function onMixedJump(pos: number, chapterId?: string): void {
  mixedPagedRef.value?.gotoPos(pos, chapterId)
}

function onMixedInsertBreak(): void {
  if (mixedBlockPos.value >= 0)
    void mixedPagedRef.value?.insertBreakBefore(mixedBlockPos.value)
}

/** 章节栏圆钮：混合界面的栏不在窗口右缘（外侧还有 292px 工具侧栏） */
function mixedToggleClass(): string {
  const st = sidebarOpen.value ? 'open' : 'closed'
  return sidebarSide.value === 'right' ? `st-mixed-right-${st}` : `st-left-${st}`
}

function onMixedTextEditor(ed: Editor | null, blockKey: string, pos: number): void {
  mixedEd.value = ed ?? undefined
  mixedBlockKey.value = blockKey
  mixedBlockPos.value = ed ? pos : -1
  mixedFirstBlock.value = pos === 0
  // 提交块编辑：这一段正文算一步，之后的改动另起一步
  if (!ed) doc.breakHistoryGroup()
}

/** 切图层等于换了一段操作：断开撤销的合并组；切到文本层时章节栏默认收起 */
function setMixedLayer(l: MixedLayer): void {
  if (mixedLayer.value === l) return
  mixedLayer.value = l
  if (l === 'text') sidebarOpen.value = false
  doc.breakHistoryGroup()
}

// 进入混合界面即落在文本层，同样默认收起章节栏
watch(
  () => app.mode,
  (m) => {
    if (m === 'mixed' && mixedLayer.value === 'text') sidebarOpen.value = false
  }
)

/** 顶栏 ↶/↷：正文与各图层共用同一条时间线，按操作先后逐层回退 */
const headerCanUndo = computed(() => doc.canUndo)
const headerCanRedo = computed(() => doc.canRedo)

function headerUndo(): void {
  doc.undo()
}

function headerRedo(): void {
  doc.redo()
}

function jsonText(node: PMJson | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(jsonText).join('')
}

/** 上一版正文 JSON：用于复刻写作模式的「空 H0 被放弃 → 解绑」判定 */
let lastMixedJson: PMJson | null | undefined

function syncH0FromJson(json: PMJson): void {
  const prev = lastMixedJson
  lastMixedJson = json
  if (doc.meta?.h0Sync === false) return
  const prevFirst = prev?.content?.[0]
  const curFirst = json.content?.[0]
  if (prevFirst?.type === 'docTitle' && !jsonText(prevFirst) && curFirst?.type !== 'docTitle') {
    doc.patchMeta({ h0Sync: false })
    return
  }
  if (curFirst?.type === 'docTitle') {
    const t = jsonText(curFirst)
    if (t && t !== doc.meta?.title) doc.patchMeta({ title: t })
  }
}

function onMixedContent(json: PMJson): void {
  syncH0FromJson(json)
  doc.patchContent(json)
}

/** 进入混合界面（或换文档）时以当前正文为 H0 联动的比较基准 */
watch(
  () => [app.mode, doc.id] as const,
  ([m]) => {
    if (m === 'mixed') lastMixedJson = doc.content
  },
  { immediate: true }
)

const editor = shallowRef<Editor>()
/** 正文编辑器实例（工具栏已上提，插入图片要回调它） */
const richRef = shallowRef<InstanceType<typeof RichEditor>>()
const chapters = ref<ChapterItem[]>([])
const activeChapterId = ref('')
let lastDoc = editor.value?.state.doc

const modeLabels: Record<WorkbenchMode, string> = {
  write: '写作',
  layout: '排版',
  mixed: '混合',
  preview: '预览'
}

const modeHints: Record<string, string> = {}

const saveText = computed(() => {
  switch (doc.saveState) {
    case 'saved':
      return '已保存'
    case 'dirty':
      return '编辑中…'
    case 'saving':
      return '保存中…'
    case 'error':
      return '保存失败'
  }
})

const h0SyncOn = computed(() => doc.meta?.h0Sync !== false)

/** 手动编辑文档名即与 H0 解绑（解绑途径 2） */
function onTitleChange(v: string): void {
  doc.patchMeta({ title: v, h0Sync: false })
}

/** 解绑/重新同步的唯一开关（解绑途径 3；重新同步仅此按钮） */
function toggleH0Sync(): void {
  if (h0SyncOn.value) {
    doc.patchMeta({ h0Sync: false })
    return
  }
  const ed = editor.value
  const first = ed && ed.state.doc.childCount ? ed.state.doc.child(0) : null
  if (isDocTitle(first) && first!.textContent) {
    doc.patchMeta({ title: first!.textContent, h0Sync: true })
  } else {
    doc.patchMeta({ h0Sync: true })
  }
}

onMounted(async () => {
  window.addEventListener('blur', onBlur)
  try {
    await doc.open(app.currentDocId)
  } catch {
    app.toLibrary()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('blur', onBlur)
  void doc.flush()
})

function onBlur(): void {
  void doc.flush()
}

function back(): void {
  void doc.flush()
  app.toLibrary()
}

function onEditorReady(ed: Editor): void {
  editor.value = ed
  lastDoc = ed.state.doc
  ed.on('transaction', onTransaction)
  if (doc.layout) ensureChapterIds(ed, doc.layout.splitRules)
  applyDefaultH0(ed)
  recalcChapters()
}

/** 新建（空）文档进入编辑时首块默认 H0；已解绑或已有内容则不动 */
function applyDefaultH0(ed: Editor): void {
  if (doc.meta?.h0Sync === false) return
  const d = ed.state.doc
  const first = d.childCount ? d.child(0) : null
  if (d.childCount === 1 && first && first.type.name === 'paragraph' && !first.textContent.length) {
    setTimeout(() => {
      if (ed.isDestroyed) return
      ed.view.dispatch(ed.state.tr.setNodeMarkup(0, ed.state.schema.nodes.docTitle))
    }, 0)
  }
}

/**
 * H0 ↔ 文档名联动（绑定开启时）：
 * - H0 文本变化 → 同步为文档名；
 * - 空 H0 被放弃（换行/手动改层级）→ 解绑。
 */
function handleH0(prevDoc: PMNode | undefined, curDoc: PMNode): void {
  if (doc.meta?.h0Sync === false) return
  const prevFirst = prevDoc && prevDoc.childCount ? prevDoc.child(0) : null
  const curFirst = curDoc.childCount ? curDoc.child(0) : null
  if (isDocTitle(prevFirst) && !prevFirst!.textContent.length && !isDocTitle(curFirst)) {
    doc.patchMeta({ h0Sync: false })
    return
  }
  if (isDocTitle(curFirst)) {
    const t = curFirst!.textContent
    if (t && t !== doc.meta?.title) doc.patchMeta({ title: t })
  }
}

function onTransaction(): void {
  const ed = editor.value
  if (!ed) return
  if (ed.state.doc !== lastDoc) {
    handleH0(lastDoc, ed.state.doc)
    lastDoc = ed.state.doc
    recalcChapters()
  }
  let active = chapters.value[0]?.chapterId ?? ''
  for (const c of chapters.value) {
    if (ed.state.selection.from >= c.pos) active = c.chapterId
  }
  activeChapterId.value = active
}

function recalcChapters(): void {
  const ed = editor.value
  if (!ed || !doc.layout) return
  chapters.value = chaptersOf(ed.state.doc, doc.layout.splitRules, doc.meta?.title ?? '')
}

watch(
  () => doc.layout?.splitRules,
  (rules) => {
    if (rules && editor.value) {
      ensureChapterIds(editor.value, rules)
      recalcChapters()
    }
  },
  { deep: true }
)

watch(
  () => doc.meta?.title,
  () => recalcChapters()
)

watch(
  () => doc.layout?.typography,
  (t) => {
    if (t) applyTypoVars(document.documentElement.style, t as Typography)
  },
  { deep: true, immediate: true }
)

function onRules(rules: SplitRules): void {
  doc.patchLayout({ splitRules: rules })
}

function jumpTo(pos: number): void {
  if (editor.value) jumpToPos(editor.value, pos)
}

function insertBreak(): void {
  editor.value?.chain().focus().insertChapterBreak().run()
}

/** 箭头指向侧栏将要移动的方向 */
function toggleArrow(): string {
  const left = sidebarSide.value === 'left'
  return sidebarOpen.value === left ? '<' : '>'
}

function onPageSetup(pageSetup: PageSetup): void {
  doc.patchLayout({ pageSetup }, 'pageSetup')
}

/** 切换纸张：同时套用该纸张推荐的页边距与正文字号，算作一步撤销 */
function onPaper(payload: { pageSetup: PageSetup; typography: Typography }): void {
  doc.patchLayout({ pageSetup: payload.pageSetup, typography: payload.typography }, 'paper')
}

function onActivePage(info: ActivePageInfo | null): void {
  activePageInfo.value = info
  if (!info) hasSelection.value = false
}

function onSelectionChange(s: { has: boolean; opacity: number }): void {
  hasSelection.value = s.has
}

function onUpdateElements(elements: import('@shared/types').FreeElement[]): void {
  // 拖动、调透明度等连续动作合为一步撤销
  doc.patchLayout({ freeElements: elements }, 'element')
}

/** 排版界面用 pagedRef，混合界面用 mixedPagedRef */
function activePaged(): InstanceType<typeof PagedView> | undefined {
  return app.mode === 'mixed' ? mixedPagedRef.value : pagedRef.value
}

function onAddElement(
  kind: import('@shared/types').FreeElement['kind'],
  scope: ElementScope,
  opts?: { src?: string; variant?: string }
): void {
  void activePaged()?.addFreeElement(kind, scope, opts)
}

function onBrush(on: boolean): void {
  activePaged()?.setBrush(on)
}

function onBg(spec: import('@shared/types').BackgroundSpec | null, scope: ElementScope): void {
  if (!doc.layout) return
  const bgs: import('@shared/types').DocLayout['backgrounds'] = {
    global: doc.layout.backgrounds.global,
    chapter: { ...doc.layout.backgrounds.chapter },
    page: { ...doc.layout.backgrounds.page }
  }
  if (scope.type === 'global') {
    bgs.global = spec
  } else if (scope.type === 'chapter') {
    if (spec) bgs.chapter[scope.chapterId] = spec
    else delete bgs.chapter[scope.chapterId]
  } else {
    const key = `${scope.chapterId}:${scope.pageIndex}`
    if (spec) bgs.page[key] = spec
    else delete bgs.page[key]
  }
  doc.patchLayout({ backgrounds: bgs }, 'background')
}
</script>

<template>
  <div class="workbench">
    <header class="wb-header">
      <div class="wb-left">
        <button class="btn ghost wb-back" @click="back">← 文档库</button>
        <div class="title-area">
          <input
            class="title-input"
            :value="doc.meta?.title ?? ''"
            placeholder="未命名文档"
            @change="onTitleChange(($event.target as HTMLInputElement).value)"
          />
          <button
            class="btn h0-sync"
            :class="{ on: h0SyncOn }"
            title="大标题与文档名同步（重新同步仅可通过「标题联动」按钮）"
            @click="toggleH0Sync"
          >
            标题联动 {{ h0SyncOn ? '开' : '关' }}
          </button>
        </div>
        <!-- 预览是纯只读界面：不提供撤销/重做 -->
        <template v-if="app.mode === 'layout' || app.mode === 'mixed'">
          <button
            class="tb-btn"
            :disabled="!headerCanUndo"
            title="撤销上一步：正文与各图层同一条时间线 (Ctrl+Z)"
            @click="headerUndo"
          >
            ↶
          </button>
          <button
            class="tb-btn"
            :disabled="!headerCanRedo"
            title="重做：正文与各图层同一条时间线 (Ctrl+Shift+Z)"
            @click="headerRedo"
          >
            ↷
          </button>
        </template>
      </div>

      <nav class="mode-tabs">
        <button
          v-for="(label, m) in modeLabels"
          :key="m"
          class="mode-tab"
          :class="{ active: app.mode === m }"
          @click="app.mode = m"
        >
          {{ label }}
        </button>
      </nav>

      <div class="wb-right">
        <span class="save-dot" :class="doc.saveState">{{ saveText }}</span>
        <button class="btn ghost" @click="showSnaps = true">快照</button>
        <button class="btn ghost" @click="app.toExport()">导出→</button>
      </div>
    </header>

    <div v-if="doc.remoteChange" class="remote-bar">
      <span>{{ doc.remoteChange.from === 'phone' ? '手机端' : '同步盘' }}已更新本篇正文，本地还有未保存的改动。</span>
      <button class="btn small" @click="void doc.acceptRemote()">载入最新版</button>
      <button class="btn small ghost" @click="doc.dismissRemote()">继续本地编辑</button>
    </div>

    <main class="wb-body" @wheel="onBodyWheel">
      <template v-if="doc.status === 'ready' && doc.content && doc.layout">
        <template v-if="app.mode === 'write'">
          <!-- 工具栏独占一行（横跨 wb-body 全宽），章节侧栏只挤压正文行：
               侧栏展开/收起不再移动任何工具栏按键 -->
          <div class="write-col">
            <EditorToolbar :editor="editor" @pick-image="richRef?.pickImage()" />
            <div class="write-row">
              <ChapterSidebar
                v-if="sidebarOpen && sidebarSide === 'left'"
                v-model:show-rules="showRules"
                :chapters="chapters"
                :active-id="activeChapterId"
                :rules="doc.layout.splitRules"
                @jump="jumpTo"
                @insert-break="insertBreak"
                @update-rules="onRules"
              />
              <RichEditor
                ref="richRef"
                :key="`${doc.id}-r${doc.contentRev}`"
                :initial="doc.content"
                :doc-id="doc.id"
                :class="{ 'vert-doc': vertDoc }"
                :style="vertDocStyle"
                @change="doc.patchContent"
                @ready="onEditorReady"
              />
              <ChapterSidebar
                v-if="sidebarOpen && sidebarSide === 'right'"
                class="cs-right"
                v-model:show-rules="showRules"
                :chapters="chapters"
                :active-id="activeChapterId"
                :rules="doc.layout.splitRules"
                @jump="jumpTo"
                @insert-break="insertBreak"
                @update-rules="onRules"
              />
              <button
                class="side-toggle"
                :class="`st-${sidebarSide}-${sidebarOpen ? 'open' : 'closed'}`"
                :title="sidebarOpen ? '收起章节侧栏' : '展开章节侧栏'"
                @click="sidebarOpen = !sidebarOpen"
              >
                {{ toggleArrow() }}
              </button>
            </div>
          </div>
        </template>

        <div v-else-if="app.mode === 'layout'" class="mode-split">
          <PagedView
            ref="pagedRef"
            editable
            :layer="editLayer"
            :content="doc.content"
            :layout="doc.layout"
            :doc-title="doc.meta?.title ?? ''"
            @page-activate="onActivePage"
            @update-elements="onUpdateElements"
            @selection-change="onSelectionChange"
          />
          <aside class="layout-panel">
            <LayerSwitch v-model="editLayer" />
            <CollapseCard v-model:open="setupOpen" title="页面设置" :hint="canvasHint">
              <PageSetupPanel
                hide-head
                :page-setup="doc.layout.pageSetup"
                :typography="doc.layout.typography"
                @update="onPageSetup"
                @update-paper="onPaper"
              />
            </CollapseCard>
            <CollapseCard
              v-model:open="presetOpen"
              title="预设"
              :hint="appliedPresetName || '未套用预设'"
            >
              <PresetPanel
                hide-head
                :active="activePageInfo"
                @applied="appliedPresetName = $event"
              />
            </CollapseCard>
            <LayerPanel
              :doc-id="doc.id"
              :layer="editLayer"
              :active="activePageInfo"
              :has-selection="hasSelection"
              :backgrounds="doc.layout.backgrounds"
              @add="onAddElement"
              @brush-toggle="onBrush"
              @del="pagedRef?.deleteSelected()"
              @dup="pagedRef?.duplicateSelected()"
              @opacity="pagedRef?.setOpacitySelected($event)"
              @bg="onBg"
            />
          </aside>
        </div>

        <div v-else-if="app.mode === 'mixed'" class="mode-split mixed-split">
          <ChapterSidebar
            v-if="mixedLayer === 'text' && sidebarOpen && sidebarSide === 'left'"
            v-model:show-rules="showRules"
            :chapters="mixedChapters"
            :active-id="mixedActiveChapter"
            :rules="doc.layout.splitRules"
            :insert-enabled="mixedBlockPos >= 0"
            @jump="onMixedJump"
            @insert-break="onMixedInsertBreak"
            @update-rules="onRules"
          />
          <PagedView
            ref="mixedPagedRef"
            :text-editable="mixedLayer === 'text'"
            :editable="mixedLayer !== 'text'"
            :layer="mixedLayer === 'bg' ? 'bg' : 'top'"
            :content="doc.content"
            :layout="doc.layout"
            :doc-title="doc.meta?.title ?? ''"
            :doc-id="doc.id"
            @update-content="onMixedContent"
            @text-editor="onMixedTextEditor"
            @chapters="mixedChapters = $event"
            @visible-page="onMixedVisiblePage"
            @page-activate="onActivePage"
            @update-elements="onUpdateElements"
            @selection-change="onSelectionChange"
          />
          <ChapterSidebar
            v-if="mixedLayer === 'text' && sidebarOpen && sidebarSide === 'right'"
            class="cs-right"
            v-model:show-rules="showRules"
            :chapters="mixedChapters"
            :active-id="mixedActiveChapter"
            :rules="doc.layout.splitRules"
            :insert-enabled="mixedBlockPos >= 0"
            @jump="onMixedJump"
            @insert-break="onMixedInsertBreak"
            @update-rules="onRules"
          />
          <button
            v-if="mixedLayer === 'text'"
            class="side-toggle"
            :class="mixedToggleClass()"
            :title="sidebarOpen ? '收起章节侧栏' : '展开章节侧栏'"
            @click="sidebarOpen = !sidebarOpen"
          >
            {{ toggleArrow() }}
          </button>
          <aside class="layout-panel mixed-panel">
            <div class="ml-switch">
              <button
                v-for="l in MIXED_LAYERS"
                :key="l.v"
                class="ml-btn"
                :class="{ on: mixedLayer === l.v }"
                :title="`切换到${l.t}`"
                @click="setMixedLayer(l.v)"
              >
                <span class="ml-btn-t">{{ l.t }}</span>
                <span class="ml-btn-s">{{ l.s }}</span>
              </button>
            </div>
            <CollapseCard v-model:open="setupOpen" title="页面设置" :hint="canvasHint">
              <PageSetupPanel
                hide-head
                :page-setup="doc.layout.pageSetup"
                :typography="doc.layout.typography"
                @update="onPageSetup"
                @update-paper="onPaper"
              />
            </CollapseCard>
            <CollapseCard
              v-model:open="presetOpen"
              title="预设"
              :hint="appliedPresetName || '未套用预设'"
            >
              <PresetPanel
                hide-head
                :active="activePageInfo"
                @applied="appliedPresetName = $event"
              />
            </CollapseCard>
            <MixedTextPanel
              v-if="mixedLayer === 'text'"
              :key="`mtp-${mixedBlockKey || 'none'}`"
              :editor="mixedEd"
              :doc-id="doc.id"
              :is-first-block="mixedFirstBlock"
            />
            <LayerPanel
              v-else
              :doc-id="doc.id"
              :layer="mixedLayer === 'bg' ? 'bg' : 'top'"
              :active="activePageInfo"
              :has-selection="hasSelection"
              :backgrounds="doc.layout.backgrounds"
              @add="onAddElement"
              @brush-toggle="onBrush"
              @del="mixedPagedRef?.deleteSelected()"
              @dup="mixedPagedRef?.duplicateSelected()"
              @opacity="mixedPagedRef?.setOpacitySelected($event)"
              @bg="onBg"
            />
          </aside>
        </div>

        <PagedView
          v-else
          :content="doc.content"
          :layout="doc.layout"
          :doc-title="doc.meta?.title ?? ''"
        />

        <ZoomControls :style="{ right: zoomDockRight }" />
      </template>
      <div v-else-if="doc.status === 'loading'" class="empty">加载中…</div>
      <div v-else-if="doc.status === 'error'" class="empty">文档加载失败</div>
    </main>

    <SnapshotDialog v-if="showSnaps" @close="showSnaps = false" />
  </div>
</template>

<style scoped>
.wb-back {
  white-space: nowrap;
  flex-shrink: 0;
}

.cs-right {
  border-right: 0;
  border-left: 1px solid var(--border);
}

.remote-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  font-size: 12px;
  background: #fff2df;
  color: #6b4a12;
  border-bottom: 1px solid var(--border);
}

.remote-bar span {
  flex: 1;
}

/* 混合界面侧栏顶部：三图层切换（排版侧栏双键改一排三键）；与 LayerSwitch 同样吸顶 */
.ml-switch {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  gap: 8px;
  padding: 14px 14px 12px;
  background: var(--panel);
}

.ml-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 12px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface, #fff);
  color: var(--ink);
  cursor: pointer;
}

.ml-btn:hover {
  border-color: var(--accent);
}

.ml-btn.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.ml-btn-t {
  font-size: 12px;
  font-weight: 600;
}

.ml-btn-s {
  font-size: 10px;
  opacity: 0.75;
}
</style>
