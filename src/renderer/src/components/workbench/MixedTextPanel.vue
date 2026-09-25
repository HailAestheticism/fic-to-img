<script setup lang="ts">
/**
 * 混合界面「文本层」侧栏：写作界面的全部文本功能平铺在侧栏里（不使用任何浮窗）。
 * editor 指向页内就地编辑的块编辑器；未选中文本块时全部功能置灰。
 * 撤销/重做、预设格式不在这里：前者用顶栏画布外的 ↶↷，后者用侧栏底部预设区。
 */
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import { api } from '../../api'
import { useDocStore } from '../../stores/doc'
import { useSystemFonts } from '../../presets/font-store'
import ColorPop from '../../editor/ColorPop.vue'
import FontSizePop from '../../editor/FontSizePop.vue'
import LineSpacingPop from '../../editor/LineSpacingPop.vue'
import ParaSpacingPop from '../../editor/ParaSpacingPop.vue'
import IndentPop from '../../editor/IndentPop.vue'

const props = defineProps<{
  editor: Editor | undefined
  docId: string
  /** 当前块是否为文档首块（H0 只允许落在首块） */
  isFirstBlock: boolean
}>()

const tick = ref(0)

/** 块编辑器每步操作都要刷新侧栏读数（与写作工具栏同一套机制） */
watch(
  () => props.editor,
  (ed, _old, onCleanup) => {
    if (!ed) return
    const bump = (): void => {
      tick.value++
    }
    ed.on('transaction', bump)
    onCleanup(() => ed.off('transaction', bump))
  },
  { immediate: true }
)

const ed = computed(() => {
  tick.value
  return props.editor
})

const docStore = useDocStore()

/** 浮窗组件内部只读一次 props，切块时由父级 :key 重建 */
function chain() {
  return ed.value!.chain().focus()
}

function act(name: string, attrs?: Record<string, unknown>): boolean {
  return !!ed.value?.isActive(name, attrs)
}

function blockAttrs(): Record<string, unknown> {
  if (!ed.value) return {}
  const type = ed.value.isActive('heading') ? 'heading' : 'paragraph'
  return ed.value.getAttributes(type)
}

function attrStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function setBlockAttrs(attrs: Record<string, string | null>): void {
  if (!ed.value) return
  chain()
    .updateAttributes('paragraph', attrs)
    .updateAttributes('heading', attrs)
    .run()
}

const textStyleAttrs = computed(() => {
  return (ed.value?.getAttributes('textStyle') ?? {}) as Record<string, unknown>
})

const currentFontFamily = computed(() => (textStyleAttrs.value.fontFamily as string) ?? '')
const currentFontSize = computed(() => attrStr(textStyleAttrs.value.fontSize))
const currentColor = computed(() => attrStr(textStyleAttrs.value.color))
const currentBgColor = computed(() => attrStr(textStyleAttrs.value.backgroundColor))
const currentLineHeight = computed(() => attrStr(blockAttrs().lineHeight))
const currentSpaceBefore = computed(() => attrStr(blockAttrs().spaceBefore))
const currentSpaceAfter = computed(() => attrStr(blockAttrs().spaceAfter))
const currentIndentLeft = computed(() => attrStr(blockAttrs().indentLeft))
const currentIndentRight = computed(() => attrStr(blockAttrs().indentRight))
const currentTextIndent = computed(() => attrStr(blockAttrs().textIndent))
const currentAlign = computed(() => (blockAttrs().textAlign as string) ?? '')
const inTable = computed(() => !!ed.value?.isActive('table'))
const isDocTitleBlock = computed(() => act('docTitle'))

const canSetH0 = computed(() => props.isFirstBlock || isDocTitleBlock.value)

const alignPaths: Record<string, string> = {
  left: 'M1 3h12M1 6.5h7M1 10h12',
  center: 'M1 3h12M3.5 6.5h7M1 10h12',
  right: 'M1 3h12M6 6.5h7M1 10h12',
  justify: 'M1 3h12M1 6.5h12M1 10h12'
}

function setLevel(level: 'h0' | 0 | 1 | 2 | 3 | 4 | 5 | 6): void {
  if (!ed.value) return
  if (level === 'h0') {
    if (!act('docTitle')) chain().setDocTitle().run()
    return
  }
  if (level === 0) chain().setParagraph().run()
  else if (act('heading', { level })) chain().setParagraph().run()
  else chain().setHeading({ level }).run()
}

function applyFontSize(v: string | null): void {
  if (!ed.value) return
  chain().setFontSize(v).run()
}

function applyFontFamily(v: string): void {
  if (!ed.value) return
  chain().setFontFamily(v || null).run()
}

function applyColor(c: string): void {
  if (!ed.value) return
  chain().setColor(c).run()
}

function applyBgColor(c: string): void {
  if (!ed.value) return
  chain().setBgColor(c).run()
}

function applyLineHeight(v: string | null): void {
  setBlockAttrs({ lineHeight: v })
}

function applyParaSpacing(patch: { before: string | null; after: string | null }): void {
  setBlockAttrs({ spaceBefore: patch.before, spaceAfter: patch.after })
}

function applyIndent(patch: {
  indentLeft: string | null
  indentRight: string | null
  textIndent: string | null
}): void {
  setBlockAttrs(patch)
}

function setAlign(a: 'left' | 'center' | 'right' | 'justify'): void {
  if (!ed.value) return
  chain().setTextAlign(currentAlign.value === a ? null : a).run()
}

// ---------- 全局竖向排列（与「画布横向」共用 pageSetup.landscape 单一状态源） ----------

const verticalOn = computed(() => docStore.layout?.pageSetup?.landscape === true)

function toggleVertical(): void {
  const ps = docStore.layout?.pageSetup
  if (!ps) return
  docStore.patchLayout(
    { pageSetup: JSON.parse(JSON.stringify({ ...ps, landscape: !ps.landscape })) },
    'pageSetup'
  )
}

// ---------- 字体（侧栏内联：搜索 + 分组列表） ----------

const { groups, loading } = useSystemFonts()
const fontFilter = ref('')
const MAX_SHOWN = 200

const fontOptions = computed(() => {
  const q = fontFilter.value.trim().toLowerCase()
  if (!q) return groups.value.map((g) => ({ name: g.name, items: g.items.slice(0, MAX_SHOWN) }))
  return groups.value
    .map((g) => ({
      name: g.name,
      items: g.items.filter(
        (f) => f.family.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)
      )
    }))
    .filter((g) => g.items.length)
})

// ---------- 插入图片 ----------

async function pickImage(): Promise<void> {
  if (!ed.value) return
  const paths = await api.dialog.openFile({
    title: '插入图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
  })
  if (!paths.length) return
  const assets = await api.assets.import(props.docId, paths)
  for (const asset of assets) {
    if (!ed.value) return
    ed.value
      .chain()
      .focus()
      .setImage({ src: asset.url, alt: asset.name })
      .run()
  }
}
</script>

<template>
  <aside class="mixed-text-panel">
    <header class="mtp-head">文本编辑</header>
    <p v-if="!editor" class="mtp-tip">点击页面正文即可就地改字</p>

    <section class="mtp-group">
      <span class="mtp-label">基础样式</span>
      <div class="mtp-row">
        <button class="tb-btn bold" :class="{ active: act('bold') }" :disabled="!editor" title="加粗 (Ctrl+B)" @click="chain().toggleBold().run()">B</button>
        <button class="tb-btn italic" :class="{ active: act('italic') }" :disabled="!editor" title="斜体 (Ctrl+I)" @click="chain().toggleItalic().run()">I</button>
        <button class="tb-btn underline" :class="{ active: act('underline') }" :disabled="!editor" title="下划线 (Ctrl+U)" @click="chain().toggleUnderline().run()">U</button>
        <button class="tb-btn strike" :class="{ active: act('strike') }" :disabled="!editor" title="删除线" @click="chain().toggleStrike().run()">S</button>
        <span class="mtp-spacer" />
        <button class="tb-btn small" :disabled="!editor" title="清除格式" @click="chain()?.unsetAllMarks().clearNodes().run()">
          清除格式
        </button>
      </div>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">文本层级</span>
      <div class="mtp-chips">
        <button
          class="btn small mtp-chip"
          :class="{ active: isDocTitleBlock }"
          :disabled="!editor || !canSetH0"
          :title="canSetH0 ? '大标题（仅首块可用）' : '大标题只能用于文档第一块'"
          @click="setLevel('h0')"
        >
          大标题
        </button>
        <button
          class="btn small mtp-chip"
          :class="{ active: act('paragraph') }"
          :disabled="!editor"
          @click="setLevel(0)"
        >
          正文
        </button>
        <button
          v-for="lv in 6"
          :key="lv"
          class="btn small mtp-chip"
          :class="{ active: act('heading', { level: lv }) }"
          :disabled="!editor"
          @click="setLevel(lv as 1 | 2 | 3 | 4 | 5 | 6)"
        >
          标题{{ lv }}
        </button>
      </div>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">字体</span>
      <input v-model="fontFilter" class="input mtp-search" :disabled="!editor" placeholder="搜索字体…" />
      <div class="mtp-fonts">
        <p v-if="loading" class="mtp-hint">正在读取本机字体…</p>
        <template v-for="g in fontOptions" :key="g.name">
          <p class="mtp-font-group">{{ g.name }}</p>
          <button
            v-for="f in g.items"
            :key="g.name + f.family"
            class="mtp-font-item"
            :class="{ active: f.family === currentFontFamily }"
            :disabled="!editor"
            :style="{ fontFamily: f.family }"
            @click="applyFontFamily(f.family)"
          >
            {{ f.label }}
            <span class="mtp-font-sample">永 Aa</span>
          </button>
        </template>
        <p v-if="!loading && !fontOptions.length" class="mtp-hint">没有匹配的字体</p>
      </div>
      <button class="tb-btn small" :disabled="!editor || !currentFontFamily" @click="applyFontFamily('')">
        恢复默认字体
      </button>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">字号</span>
      <FontSizePop
        v-if="editor"
        :model-value="currentFontSize"
        @apply="applyFontSize"
      />
      <p v-else class="mtp-hint">未选中文本块</p>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">文本颜色</span>
      <ColorPop
        v-if="editor"
        kind="text"
        :model-value="currentColor"
        @apply="applyColor"
        @clear="chain()?.setColor(null).run()"
      />
      <p v-else class="mtp-hint">未选中文本块</p>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">填充颜色</span>
      <ColorPop
        v-if="editor"
        kind="fill"
        :model-value="currentBgColor"
        @apply="applyBgColor"
        @clear="chain()?.setBgColor(null).run()"
      />
      <p v-else class="mtp-hint">未选中文本块</p>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">行距</span>
      <LineSpacingPop v-if="editor" :model-value="currentLineHeight" @apply="applyLineHeight" />
      <p v-else class="mtp-hint">未选中文本块</p>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">段间距</span>
      <ParaSpacingPop v-if="editor" :before="currentSpaceBefore" :after="currentSpaceAfter" @apply="applyParaSpacing" />
      <p v-else class="mtp-hint">未选中文本块</p>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">缩进</span>
      <IndentPop
        v-if="editor"
        :indent-left="currentIndentLeft"
        :indent-right="currentIndentRight"
        :text-indent="currentTextIndent"
        @apply="applyIndent"
      />
      <p v-else class="mtp-hint">未选中文本块</p>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">对齐与排列</span>
      <div class="mtp-row">
        <button
          v-for="a in ['left', 'center', 'right', 'justify'] as const"
          :key="a"
          class="tb-btn"
          :class="{ active: currentAlign === a }"
          :disabled="!editor"
          :title="{ left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' }[a]"
          @click="setAlign(a)"
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path :d="alignPaths[a]" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" />
          </svg>
        </button>
        <button
          class="tb-btn"
          :class="{ active: verticalOn }"
          :title="verticalOn ? '竖向排列：全局开（画布已切横向，再点恢复横排纵向）' : '竖向排列：全文档生效（自动切换画布横向），图片表格除外'"
          @click="toggleVertical"
        >
          <svg width="14" height="14" viewBox="0 0 14 14">
            <path d="M3 1v12M6.5 1v12M10 1v12" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">列表与引用</span>
      <div class="mtp-row">
        <button class="tb-btn" :class="{ active: act('bulletList') }" :disabled="!editor" title="无序列表" @click="chain()?.toggleBulletList().run()">•―</button>
        <button class="tb-btn" :class="{ active: act('orderedList') }" :disabled="!editor" title="有序列表" @click="chain()?.toggleOrderedList().run()">1.</button>
        <button class="tb-btn" :class="{ active: act('blockquote') }" :disabled="!editor" title="引用" @click="chain()?.toggleBlockquote().run()">❝</button>
        <button class="tb-btn" :disabled="!editor" title="分割线" @click="chain()?.setHorizontalRule().run()">—</button>
      </div>
    </section>

    <section class="mtp-group">
      <span class="mtp-label">插入</span>
      <div class="mtp-row">
        <button class="tb-btn" :disabled="!editor" title="插入图片" @click="void pickImage()">🖼</button>
        <button
          class="tb-btn"
          :disabled="!editor"
          title="插入表格"
          @click="chain()?.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()"
        >
          ⊞
        </button>
        <button class="tb-btn" :disabled="!editor" title="插入章节符（分章）" @click="chain()?.insertChapterBreak().run()">章</button>
      </div>
    </section>

    <section v-if="inTable && editor" class="mtp-group">
      <span class="mtp-label">表格</span>
      <div class="mtp-chips">
        <button class="tb-btn small" title="上方插入行" @click="chain().addRowBefore().run()">+行↑</button>
        <button class="tb-btn small" title="下方插入行" @click="chain().addRowAfter().run()">+行↓</button>
        <button class="tb-btn small" title="左侧插入列" @click="chain().addColumnBefore().run()">+列←</button>
        <button class="tb-btn small" title="右侧插入列" @click="chain().addColumnAfter().run()">+列→</button>
        <button class="tb-btn small" title="删除行" @click="chain().deleteRow().run()">−行</button>
        <button class="tb-btn small" title="删除列" @click="chain().deleteColumn().run()">−列</button>
        <button class="tb-btn small" title="切换表头行" @click="chain().toggleHeaderRow().run()">表头</button>
        <button class="tb-btn small" title="删除表格" @click="chain().deleteTable().run()">删表</button>
      </div>
    </section>
  </aside>
</template>

<style>
.mixed-text-panel {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-bottom: 1px solid var(--border);
}

.mtp-head {
  font-size: 13px;
  font-weight: 600;
}

.mtp-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

/* 原浮窗按键 → 侧栏小小标题 */
.mtp-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.02em;
}

.mtp-tip,
.mtp-hint {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}

.mtp-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.mtp-spacer {
  flex: 1;
}

.mtp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.mtp-chip.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.mtp-search {
  width: 100%;
  padding: 3px 6px;
  font-size: 12px;
}

.mtp-fonts {
  max-height: 168px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px;
}

.mtp-font-group {
  margin: 4px 2px 2px;
  font-size: 11px;
  color: var(--muted);
  position: sticky;
  top: 0;
  background: var(--panel);
}

.mtp-font-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--ink);
  font-size: 12px;
  padding: 4px 6px;
  border-radius: 5px;
  text-align: left;
}

.mtp-font-item:hover {
  background: var(--panel-soft);
}

.mtp-font-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.mtp-font-sample {
  font-size: 11px;
  color: var(--muted);
}

/* 浮窗组件内联进侧栏：宽度随侧栏，去掉外框阴影 */
.mixed-text-panel .fsz-pop,
.mixed-text-panel .lsp-pop,
.mixed-text-panel .psp-pop,
.mixed-text-panel .idp-pop,
.mixed-text-panel .cp {
  width: auto;
}

.mixed-text-panel .fsz-pop .tb-pop-row,
.mixed-text-panel .lsp-pop .tb-pop-row,
.mixed-text-panel .psp-pop .tb-pop-row,
.mixed-text-panel .idp-pop .tb-pop-row,
.mixed-text-panel .cp-row,
.mixed-text-panel .cp-swatches {
  margin-bottom: 0;
}

.mixed-text-panel .tb-btn.small {
  height: 22px;
  min-width: 0;
  padding: 0 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 5px;
}

/* 浮窗组件按 240px 浮层排的定宽标签在侧栏里会被挤成竖排，这里改为按内容撑开 */
.mixed-text-panel .tb-pop-row > label {
  width: auto;
  min-width: 26px;
  white-space: nowrap;
}

.mixed-text-panel .tb-pop-input,
.mixed-text-panel .tb-pop-row input {
  min-width: 0;
  flex: 1;
}
</style>
