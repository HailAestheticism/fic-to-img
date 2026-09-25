<script setup lang="ts">
import { nextTick, onMounted, ref, useAttrs, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import type { Editor } from '@tiptap/core'
import type { PMNode } from '@shared/types'
import { api } from '../api'
import { useZoom } from '../composables/zoom'
import { buildExtensions } from './setup'

const props = defineProps<{ initial: PMNode; docId: string }>()
const emit = defineEmits<{
  (e: 'change', json: PMNode): void
  (e: 'ready', editor: Editor): void
}>()

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const editor = useEditor({
  content: props.initial,
  extensions: buildExtensions(),
  editorProps: {
    attributes: { class: 'tiptap-prose' },
    handlePaste: (_view, event) => {
      const files = imageFiles(event.clipboardData?.files)
      if (files.length) {
        void importImages(files)
        return true
      }
      return false
    },
    handleDrop: (_view, event, _slice, moved) => {
      if (moved) return false
      const files = imageFiles(event.dataTransfer?.files)
      if (files.length) {
        void importImages(files)
        return true
      }
      return false
    }
  },
  onUpdate: ({ editor }) => emit('change', editor.getJSON()),
  onCreate: ({ editor }) => emit('ready', editor)
})

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter(
    (f) => f.type.startsWith('image/') && f.size <= MAX_IMAGE_BYTES
  )
}

async function importImages(files: File[]): Promise<void> {
  for (const file of files) {
    try {
      const base64 = await fileToBase64(file)
      const asset = await api.assets.saveData(props.docId, file.name || 'image.png', base64)
      editor.value
        ?.chain()
        .focus()
        .setImage({ src: asset.url, alt: asset.name })
        .run()
    } catch {
      /* 单张失败不中断其余图片 */
    }
  }
}

async function pickImage(): Promise<void> {
  const paths = await api.dialog.openFile({
    title: '插入图片',
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
  })
  if (!paths.length) return
  const assets = await api.assets.import(props.docId, paths)
  for (const asset of assets) {
    editor.value
      ?.chain()
      .focus()
      .setImage({ src: asset.url, alt: asset.name })
      .run()
  }
}

// 工具栏已上提到 WorkbenchView（与章节侧栏分行、互不干扰），插入图片仍由这里代办
defineExpose({ pickImage })

// ---------- 竖排（vert-doc）起始视口锚定 ----------
// 正文自右向左展开，但横向滚动容器默认锚在左端（= 文末列）；
// 进入竖排时把 scrollLeft 推到最右，让首列（h0）落在可视区右缘。
const attrs = useAttrs()
const scrollEl = ref<HTMLDivElement>()
/** 写作界面缩放（阶段 24）：只放大正文版心列（含字号与行宽），工具栏保持原尺寸 */
const { factor: zoomFactor } = useZoom()

function anchorRight(): void {
  const el = scrollEl.value
  if (!el) return
  el.scrollLeft = el.scrollWidth - el.clientWidth
}

/** 列宽依赖字体与竖排布局的最终测量，挂载瞬间常还没稳定：多档延迟重试 */
function anchorRightSettled(): void {
  requestAnimationFrame(() => anchorRight())
  setTimeout(() => anchorRight(), 150)
  setTimeout(() => anchorRight(), 600)
}

function isVertDoc(): boolean {
  // 父级 :class 对象会被 Vue 规范化为字符串（mergeProps 合并根节点 attrs）
  return String(attrs.class || '').split(/\s+/).includes('vert-doc')
}

onMounted(() => {
  if (isVertDoc()) anchorRightSettled()
})

watch(
  () => isVertDoc(),
  (v) => {
    if (!v) return
    void nextTick(() => anchorRightSettled())
  }
)
</script>

<template>
  <div class="rich-editor">
    <div ref="scrollEl" class="editor-scroll">
      <EditorContent :editor="editor" class="editor-shell" :style="{ zoom: String(zoomFactor) }" />
    </div>
  </div>
</template>
