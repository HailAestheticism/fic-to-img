<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import { useDocStore } from '../stores/doc'
import FontSelect from '../components/common/FontSelect.vue'
import PresetFormatDialog from '../components/workbench/PresetFormatDialog.vue'
import TbPop from './TbPop.vue'
import ColorPop from './ColorPop.vue'
import FontSizePop from './FontSizePop.vue'
import LineSpacingPop from './LineSpacingPop.vue'
import ParaSpacingPop from './ParaSpacingPop.vue'
import IndentPop from './IndentPop.vue'

const props = defineProps<{ editor: Editor | undefined }>()
const emit = defineEmits<{ (e: 'pick-image'): void }>()

const tick = ref(0)
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

const showPresetFormat = ref(false)

function chain() {
  return props.editor!.chain().focus()
}

function act(name: string, attrs?: Record<string, unknown>): boolean {
  tick.value
  return !!props.editor?.isActive(name, attrs)
}

/** 光标所在块（段落或标题）的自定义属性 */
function blockAttrs(): Record<string, unknown> {
  tick.value
  if (!props.editor) return {}
  const type = props.editor.isActive('heading') ? 'heading' : 'paragraph'
  return props.editor.getAttributes(type)
}

function attrStr(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function setBlockAttrs(attrs: Record<string, string | null>): void {
  chain()
    .updateAttributes('paragraph', attrs)
    .updateAttributes('heading', attrs)
    .run()
}

const textStyleAttrs = computed(() => {
  tick.value
  return (props.editor?.getAttributes('textStyle') ?? {}) as Record<string, unknown>
})

const currentFontFamily = computed(() => (textStyleAttrs.value.fontFamily as string) ?? '')
const currentFontSize = computed(() => attrStr(textStyleAttrs.value.fontSize))
const currentColor = computed(() => attrStr(textStyleAttrs.value.color))
const currentBgColor = computed(() => attrStr(textStyleAttrs.value.backgroundColor))

const currentLevelLabel = computed(() => {
  if (act('docTitle')) return '大标题'
  for (let lv = 1; lv <= 6; lv++) {
    if (act('heading', { level: lv })) return `标题${lv}`
  }
  return '正文'
})

/** H0 只能落在文档第一块 */
const canSetH0 = computed(() => {
  tick.value
  const ed = props.editor
  if (!ed) return false
  const { $from } = ed.state.selection
  return $from.depth === 1 && $from.index(0) === 0
})

const currentLineHeight = computed(() => attrStr(blockAttrs().lineHeight))
const currentSpaceBefore = computed(() => attrStr(blockAttrs().spaceBefore))
const currentSpaceAfter = computed(() => attrStr(blockAttrs().spaceAfter))
const currentIndentLeft = computed(() => attrStr(blockAttrs().indentLeft))
const currentIndentRight = computed(() => attrStr(blockAttrs().indentRight))
const currentTextIndent = computed(() => attrStr(blockAttrs().textIndent))

const currentAlign = computed(() => (blockAttrs().textAlign as string) ?? '')

// ---------- 全局竖向排列（与「画布横向」共用 pageSetup.landscape 单一状态源） ----------

const doc = useDocStore()
const verticalOn = computed(() => doc.layout?.pageSetup?.landscape === true)

function toggleVertical(): void {
  const ps = doc.layout?.pageSetup
  if (!ps) return
  doc.patchLayout(
    { pageSetup: JSON.parse(JSON.stringify({ ...ps, landscape: !ps.landscape })) },
    'pageSetup'
  )
}

const alignPaths: Record<string, string> = {
  left: 'M1 3h12M1 6.5h7M1 10h12',
  center: 'M1 3h12M3.5 6.5h7M1 10h12',
  right: 'M1 3h12M6 6.5h7M1 10h12',
  justify: 'M1 3h12M1 6.5h12M1 10h12'
}

function setLevel(level: 'h0' | 0 | 1 | 2 | 3 | 4 | 5 | 6): void {
  if (level === 'h0') {
    if (!act('docTitle')) chain().setDocTitle().run()
    return
  }
  if (level === 0) chain().setParagraph().run()
  else if (act('heading', { level })) chain().setParagraph().run()
  else chain().setHeading({ level }).run()
}

function applyFontSize(v: string | null): void {
  chain().setFontSize(v).run()
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

const inTable = computed(() => (tick.value, !!props.editor?.isActive('table')))
</script>

<template>
  <div v-if="editor" class="editor-toolbar">
    <button class="tb-btn" title="撤销 (Ctrl+Z)" @click="chain().undo().run()">↶</button>
    <button class="tb-btn" title="重做 (Ctrl+Y)" @click="chain().redo().run()">↷</button>
    <div class="tb-sep" />

    <TbPop
      label="文本层级"
      :title="`文本层级（当前：${currentLevelLabel}）`"
      :active="act('heading') || act('docTitle')"
      :width="120"
    >
      <template #default="{ close }">
        <div class="tb-level-list">
          <button
            class="tb-level-item"
            :class="{ active: act('docTitle') }"
            :disabled="!canSetH0 && !act('docTitle')"
            :title="canSetH0 || act('docTitle') ? '大标题（仅第一行可用）' : '大标题只能用于文档第一行'"
            @click="setLevel('h0'); close()"
          >
            大标题
          </button>
          <button
            class="tb-level-item"
            :class="{ active: act('paragraph') }"
            @click="setLevel(0); close()"
          >
            正文
          </button>
          <button
            v-for="lv in 6"
            :key="lv"
            class="tb-level-item"
            :class="{ active: act('heading', { level: lv }) }"
            @click="setLevel(lv as 1 | 2 | 3 | 4 | 5 | 6); close()"
          >
            标题{{ lv }}
          </button>
        </div>
      </template>
    </TbPop>

    <button class="tb-btn bold" :class="{ active: act('bold') }" title="加粗 (Ctrl+B)" @click="chain().toggleBold().run()">
      B
    </button>
    <button class="tb-btn italic" :class="{ active: act('italic') }" title="斜体 (Ctrl+I)" @click="chain().toggleItalic().run()">
      I
    </button>
    <button class="tb-btn underline" :class="{ active: act('underline') }" title="下划线 (Ctrl+U)" @click="chain().toggleUnderline().run()">
      U
    </button>
    <button class="tb-btn strike" :class="{ active: act('strike') }" title="删除线" @click="chain().toggleStrike().run()">
      S
    </button>

    <TbPop label="文本颜色" title="文本颜色" :indicator="currentColor || ''">
      <template #default>
        <ColorPop
          kind="text"
          :model-value="currentColor"
          @apply="(c: string) => chain().setColor(c).run()"
          @clear="chain().setColor(null).run()"
        />
      </template>
    </TbPop>
    <TbPop label="填充颜色" title="填充颜色（文字背景）" :indicator="currentBgColor || ''">
      <template #default>
        <ColorPop
          kind="fill"
          :model-value="currentBgColor"
          @apply="(c: string) => chain().setBgColor(c).run()"
          @clear="chain().setBgColor(null).run()"
        />
      </template>
    </TbPop>

    <span class="tb-font">
      <FontSelect
        :model-value="currentFontFamily"
        placeholder="字体"
        title="字体"
        @update:model-value="(v: string) => chain().setFontFamily(v || null).run()"
      />
    </span>
    <TbPop label="字号" title="字号" :width="216">
      <template #default>
        <FontSizePop :model-value="currentFontSize" @apply="applyFontSize" />
      </template>
    </TbPop>
    <div class="tb-sep" />

    <TbPop label="行距" title="行距" :width="232">
      <template #default>
        <LineSpacingPop :model-value="currentLineHeight" @apply="applyLineHeight" />
      </template>
    </TbPop>
    <TbPop label="段间距" title="段间距" :width="252">
      <template #default>
        <ParaSpacingPop
          :before="currentSpaceBefore"
          :after="currentSpaceAfter"
          @apply="applyParaSpacing"
        />
      </template>
    </TbPop>
    <TbPop label="缩进" title="缩进" :width="256">
      <template #default>
        <IndentPop
          :indent-left="currentIndentLeft"
          :indent-right="currentIndentRight"
          :text-indent="currentTextIndent"
          @apply="applyIndent"
        />
      </template>
    </TbPop>

    <button
      v-for="a in ['left', 'center', 'right', 'justify'] as const"
      :key="a"
      class="tb-btn"
      :class="{ active: currentAlign === a }"
      :title="{ left: '左对齐', center: '居中', right: '右对齐', justify: '两端对齐' }[a]"
      @click="chain().setTextAlign(currentAlign === a ? null : a).run()"
    >
      <svg width="14" height="14" viewBox="0 0 14 14">
        <path
          :d="alignPaths[a]"
          stroke="currentColor"
          stroke-width="1.4"
          fill="none"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <button
      class="tb-btn"
      :class="{ active: verticalOn }"
      :title="verticalOn ? '竖向排列：全局开（画布已切横向，再点恢复横排纵向）' : '竖向排列：全文档生效（自动切换画布横向），图片表格除外'"
      @click="toggleVertical"
    >
      <svg width="14" height="14" viewBox="0 0 14 14">
        <path
          d="M3 1v12M6.5 1v12M10 1v12"
          stroke="currentColor"
          stroke-width="1.4"
          fill="none"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <div class="tb-sep" />

    <button class="tb-btn" :class="{ active: act('bulletList') }" title="无序列表" @click="chain().toggleBulletList().run()">
      •―
    </button>
    <button class="tb-btn" :class="{ active: act('orderedList') }" title="有序列表" @click="chain().toggleOrderedList().run()">
      1.
    </button>
    <button class="tb-btn" :class="{ active: act('blockquote') }" title="引用" @click="chain().toggleBlockquote().run()">
      ❝
    </button>
    <button class="tb-btn" title="分割线" @click="chain().setHorizontalRule().run()">—</button>
    <div class="tb-sep" />

    <button class="tb-btn" title="插入图片" @click="emit('pick-image')">🖼</button>
    <button class="tb-btn" title="插入表格" @click="chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()">
      ⊞
    </button>
    <button class="tb-btn" title="插入章节符（分章）" @click="chain().insertChapterBreak().run()">章</button>
    <div class="tb-sep" />

    <button
      class="tb-btn tb-text-btn"
      title="清除格式"
      @click="chain().unsetAllMarks().clearNodes().run()"
    >
      清除格式
    </button>
    <button class="tb-btn tb-text-btn" title="预设格式（文档默认排版）" @click="showPresetFormat = true">
      预设格式
    </button>

    <template v-if="inTable">
      <div class="tb-sep" />
      <button class="tb-btn" title="上方插入行" @click="chain().addRowBefore().run()">+行↑</button>
      <button class="tb-btn" title="下方插入行" @click="chain().addRowAfter().run()">+行↓</button>
      <button class="tb-btn" title="左侧插入列" @click="chain().addColumnBefore().run()">+列←</button>
      <button class="tb-btn" title="右侧插入列" @click="chain().addColumnAfter().run()">+列→</button>
      <button class="tb-btn" title="删除行" @click="chain().deleteRow().run()">−行</button>
      <button class="tb-btn" title="删除列" @click="chain().deleteColumn().run()">−列</button>
      <button class="tb-btn" title="切换表头行" @click="chain().toggleHeaderRow().run()">表头</button>
      <button class="tb-btn" title="删除表格" @click="chain().deleteTable().run()">删表</button>
    </template>
  </div>

  <PresetFormatDialog v-if="showPresetFormat" @close="showPresetFormat = false" />
</template>

<style>
.tb-level-list {
  display: flex;
  flex-direction: column;
}

.tb-level-item {
  border: none;
  background: transparent;
  color: var(--ink);
  font-size: 12px;
  text-align: left;
  padding: 5px 10px;
  border-radius: 6px;
}

.tb-level-item:hover {
  background: var(--panel-soft);
}

.tb-level-item:disabled {
  opacity: 0.4;
  cursor: default;
  background: transparent;
}

.tb-level-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.tb-text-btn {
  font-size: 12px;
}
</style>
