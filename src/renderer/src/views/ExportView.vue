<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { DocBundle, ExportCheckResult, ExportFormat, ExportPageInfo, ExportProgress, ExportQuality } from '@shared/types'
import {
  COMPRESS_BLUR_PIXEL_LIMIT,
  EXPORT_SIZE_BYTES_PER_KPX,
  EXPORT_SIZE_FLOW_PACK,
  EXPORT_SIZE_FLOW_PX_PACK,
  EXPORT_SIZE_FLOW_IMAGE_KB,
  EXPORT_SIZE_HD_FACTOR,
  EXPORT_SIZE_PAGE_IMAGE_KB,
  EXPORT_SIZE_ZIP_RATIO,
  formatBytes
} from '@shared/types'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useDocStore } from '../stores/doc'
import ExportPreviewGrid from '../export/ExportPreviewGrid.vue'

const app = useAppStore()
const docStore = useDocStore()

const bundle = ref<DocBundle | null>(null)
const loadingBundle = ref(false)
const pages = ref<ExportPageInfo[]>([])

type RangeKey = 'all' | 'chapters' | 'pages'

const options = reactive({
  range: 'all' as RangeKey,
  format: 'long' as ExportFormat,
  quality: 'original' as ExportQuality,
  chapterIds: [] as string[],
  pageIndices: [] as number[],
  outputDir: ''
})

/**
 * 形式清单随范围而变（交接文档.md §4）：
 * 全文 = 整篇成品；部分章节/部分页 = 「分…（打包）」或「合成大…」（选中内容首尾相接成一份成品）。
 */
const FORMATS_BY_RANGE: Record<RangeKey, { value: ExportFormat; label: string; hint: string }[]> = {
  all: [
    { value: 'long', label: '全文长图 PNG', hint: '整篇首尾相接成一张长图，无损' },
    { value: 'chapterZip', label: '分章节 PNG（打包）', hint: '每章一组页面图，打包成 ZIP' },
    { value: 'pages', label: '分页 PNG（打包）', hint: '逐页一张图，打包成 ZIP' },
    { value: 'jpeg', label: '全文长图 JPEG', hint: '整篇一张长图，有损编码（平台兼容性最好）' }
  ],
  chapters: [
    { value: 'chapterZip', label: '分章节 PNG（打包）', hint: '每个选中章节一组页面图，打包成 ZIP' },
    { value: 'long', label: '合成大 PNG', hint: '选中章节按章节顺序连成一张长图（单章即整章一图）' },
    { value: 'jpeg', label: '合成大 JPEG', hint: '选中章节连成一张长图后转 JPEG' }
  ],
  pages: [
    { value: 'pages', label: '分页 PNG（打包）', hint: '每个选中页一张图，打包成 ZIP' },
    { value: 'long', label: '合成大 PNG', hint: '选中页按页码顺序连成一张长图（单页即单页一图）' },
    { value: 'jpeg', label: '合成大 JPEG', hint: '选中页连成一张长图后转 JPEG' }
  ]
}

const isInfinite = computed(() => bundle.value?.layout.pageSetup.infiniteHeight === true)

/** 无限长图没有「页」的概念：整篇是一串章节长图 */
const formatItems = computed(() =>
  FORMATS_BY_RANGE[options.range].map((f) =>
    f.value === 'chapterZip' && isInfinite.value
      ? { ...f, label: '分章节 PNG（打包）', hint: '每章一张长图，打包成 ZIP' }
      : f
  )
)

const formatHint = computed(
  () => formatItems.value.find((f) => f.value === options.format)?.hint ?? ''
)

const QUALITY_OPTIONS = [
  { value: 'original', label: '原图', hint: '1 倍截图 · 无损' },
  { value: 'hd', label: '高清', hint: '300 DPI · 适合印刷' },
  { value: 'compressed', label: '压缩', hint: '单张 ≤2MB · 适应社媒' }
] as const

const qualityHint = computed(() => QUALITY_OPTIONS.find((q) => q.value === options.quality)?.hint ?? '')

function scaleFor(q: ExportQuality): number {
  return q === 'hd' ? 3.125 : 1
}

const checks = ref<ExportCheckResult | null>(null)
const checking = ref(false)
const exporting = ref(false)
const errorMsg = ref('')
const progress = ref<ExportProgress | null>(null)
const resultFiles = ref<string[]>([])
const resultDir = ref('')
const resultBytes = ref(0)

let unsubscribe: (() => void) | null = null

// 章节列表从内容 JSON 直接派生（与写作模式导航同一套规则）
const chapters = computed(() => {
  if (!bundle.value) return []
  const layout = bundle.value.layout
  const rules = layout.splitRules
  const list: { id: string; title: string }[] = []
  const hit = (node: PMNodeLike): boolean => {
    if (node.type !== 'heading') return false
    if (rules.h1 && node.attrs?.level === 1) return true
    if (rules.regex && rules.pattern) {
      try {
        if (new RegExp(rules.pattern).test(plainText(node))) return true
      } catch {
        /* 非法正则忽略 */
      }
    }
    return false
  }
  for (const block of bundle.value.content.content ?? []) {
    if (block.type === 'chapterBreak') {
      list.push({
        id: String(block.attrs?.chapterId ?? ''),
        title: String(block.attrs?.title || '未命名章节')
      })
    } else if (hit(block)) {
      list.push({
        id: String(block.attrs?.chapterId ?? ''),
        title: plainText(block) || '未命名章节'
      })
    }
  }
  if (!list.length) list.push({ id: '__doc', title: bundle.value.meta.title || '全文' })
  return list
})

/** 当前范围下实际会被导出的页 */
const rangePages = computed(() => {
  if (options.range === 'chapters') {
    const ids = new Set(options.chapterIds)
    return pages.value.filter((p) => ids.has(p.chapterId))
  }
  if (options.range === 'pages') {
    const set = new Set(options.pageIndices)
    return pages.value.filter((p) => set.has(p.index))
  }
  return pages.value
})

/** 缩略图：整幅一图类（长图/合成大）用一个框展示成品，其余逐框 */
const galleryMode = computed<'frames' | 'flow'>(() =>
  options.format === 'long' || options.format === 'jpeg' ? 'flow' : 'frames'
)

/** 本次导出的成品文件数（打包不含 ZIP 本体） */
const outputFiles = computed(() => {
  const ps = rangePages.value
  switch (options.format) {
    case 'long':
    case 'jpeg':
      return ps.length ? 1 : 0
    case 'pages':
      return ps.length
    // 分章节 PNG：分页画布逐页成图，无限画布每章一张长图
    case 'chapterZip':
      return isInfinite.value ? new Set(ps.map((p) => p.chapterId)).size : ps.length
  }
  return 0
})

const zipped = computed(() => options.format === 'chapterZip' || options.format === 'pages')

/**
 * 位图分组：一组 = 一张成品图。ink = 正文实占面积（体积主导项，留白几乎不占字节），
 * pageLike 标记逐页成图——它要把底纹色带/页脚/装饰按页重画，固定开销远大于整幅一图。
 * 整幅一图是连续流，正文首尾相接，ink 只按打包率轻微收紧。
 */
function imageGroups(): { ink: number; pageLike: boolean }[] {
  const s2 = scaleFor(options.quality) ** 2
  const per = (p: ExportPageInfo): number => p.inkCss * s2
  const ps = rangePages.value
  if (options.format === 'pages' || options.format === 'chapterZip') {
    return ps.map((p) => ({ ink: per(p), pageLike: true }))
  }
  const sum = ps.reduce((t, p) => t + per(p), 0)
  if (!sum) return []
  return [{ ink: sum * (isInfinite.value ? 1 : EXPORT_SIZE_FLOW_PACK), pageLike: false }]
}

/** 成品图整幅画布面积（压缩模糊判据：像素太多而字节被压到 2MB 就会糊） */
function groupPixels(): number[] {
  const s2 = scaleFor(options.quality) ** 2
  const per = (p: ExportPageInfo): number => p.widthCss * p.heightCss * s2
  const ps = rangePages.value
  if (options.format === 'pages' || options.format === 'chapterZip') return ps.map(per)
  const sum = ps.reduce((t, p) => t + per(p), 0)
  if (!sum) return []
  return [sum * (isInfinite.value ? 1 : EXPORT_SIZE_FLOW_PX_PACK)]
}

/**
 * 体积预测：位图按正文实占面积折算（PDF 导出功能已删除，不再有矢量分支）。
 * 打包类把 ZIP 本体也算进来——成品图本身已压缩，ZIP 几乎不再变小。
 * 系数见 @shared/types 注释（sample-long 纯文字页实测），含图片/底纹的文档会明显偏大。
 */
const sizeEstimate = computed(() => {
  const ps = rangePages.value
  if (!ps.length) return ''
  const perKpx =
    (options.format === 'jpeg' ? EXPORT_SIZE_BYTES_PER_KPX.jpeg : EXPORT_SIZE_BYTES_PER_KPX.png) *
    (options.quality === 'hd' ? EXPORT_SIZE_HD_FACTOR : 1)
  let bytes = 0
  for (const g of imageGroups()) {
    const kb = g.pageLike ? EXPORT_SIZE_PAGE_IMAGE_KB : EXPORT_SIZE_FLOW_IMAGE_KB
    // 压缩档把单张成品压到 2MB 以内
    const b = (g.ink / 1000) * perKpx + kb * 1024
    bytes += options.quality === 'compressed' ? Math.min(b, 2 * 1024 * 1024) : b
  }
  if (zipped.value) bytes *= 1 + EXPORT_SIZE_ZIP_RATIO
  return `预计 ${outputFiles.value} 个文件 · 约 ${formatBytes(bytes)}${zipped.value ? '（含打包）' : ''}`
})

/** 压缩档实时预估：任一成品图超过约 200 万像素（2MB ÷ 1 字节/像素）就会糊 */
const compressWarn = computed(() => {
  if (options.quality !== 'compressed' || !rangePages.value.length) return ''
  const over = groupPixels().filter((px) => px > COMPRESS_BLUR_PIXEL_LIMIT)
  if (!over.length) return ''
  const max = Math.max(...over)
  return `图片尺寸过大（最大约 ${(max / 10000).toFixed(0)} 万像素），压缩会导致模糊，建议改小范围或换清晰度。`
})

/** 按页导出时的页标签 */
function pageLabel(p: ExportPageInfo): string {
  return `第 ${p.index + 1} 页 · ${p.chapterTitle} 第 ${p.pageIndexInChapter + 1} 页`
}

interface PMNodeLike {
  type: string
  attrs?: Record<string, any>
  content?: PMNodeLike[]
  text?: string
}

function plainText(node: PMNodeLike): string {
  if (node.text) return node.text
  return (node.content ?? []).map(plainText).join('')
}

/** 去掉 Electron IPC 的包装前缀，只留真正的失败原因 */
function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, '')
}

const docId = computed(() => docStore.id || app.currentDocId || '')

onMounted(async () => {
  unsubscribe = api.onExportProgress((p) => {
    progress.value = p
  })
  if (docId.value) await loadBundle()
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})

async function loadBundle(): Promise<void> {
  bundle.value = null
  checks.value = null
  pages.value = []
  if (!docId.value) return
  loadingBundle.value = true
  try {
    bundle.value = await api.docs.get(docId.value)
    if (isInfinite.value) {
      options.format = 'long'
      options.range = 'all'
    }
    pages.value = await api.export.listPages(buildOptions(), bundle.value)
  } catch (e) {
    errorMsg.value = errText(e)
  } finally {
    loadingBundle.value = false
  }
}

watch(
  () => docId.value,
  () => {
    loadBundle()
  }
)

// 范围决定可用形式：切换范围后若当前形式不在清单内，落到该范围的首选
watch(
  () => [options.range, isInfinite.value] as const,
  ([r, inf]) => {
    if (r === 'pages' && inf) options.range = 'all'
    const list = FORMATS_BY_RANGE[options.range]
    if (!list.some((f) => f.value === options.format)) options.format = list[0].value
  }
)

async function pickOutputDir(): Promise<void> {
  const dir = await api.dialog.openDirectory()
  if (dir) options.outputDir = dir
}

async function runChecks(): Promise<void> {
  if (!bundle.value) return
  checking.value = true
  errorMsg.value = ''
  try {
    checks.value = await api.export.checks(buildOptions(), bundle.value)
  } catch (e) {
    errorMsg.value = errText(e)
  } finally {
    checking.value = false
  }
}

function buildOptions() {
  return {
    docId: docId.value,
    title: bundle.value?.meta.title ?? '未命名文档',
    format: options.format,
    quality: options.quality,
    scale: scaleFor(options.quality),
    range: options.range,
    chapterIds: options.range === 'chapters' ? options.chapterIds : null,
    pageIndices: options.range === 'pages' ? options.pageIndices : null,
    // 界面不再暴露：无限画布的「分章节 PNG」由主进程内部按章拆图
    longScope: 'doc' as const,
    outputDir: options.outputDir
  }
}

const canExport = computed(
  () =>
    !!bundle.value &&
    !!options.outputDir &&
    !exporting.value &&
    rangePages.value.length > 0 &&
    (options.range !== 'chapters' || options.chapterIds.length > 0) &&
    (options.range !== 'pages' || options.pageIndices.length > 0)
)

async function startExport(): Promise<void> {
  if (!canExport.value) return
  exporting.value = true
  errorMsg.value = ''
  resultFiles.value = []
  resultBytes.value = 0
  progress.value = { phase: 'prepare', done: 0, total: 0, message: '准备中…' }
  try {
    const result = await api.export.run(buildOptions(), bundle.value!)
    resultFiles.value = result.zipFile ? [...result.files, result.zipFile] : result.files
    resultDir.value = result.outputDir
    resultBytes.value = result.totalBytes
  } catch (e) {
    errorMsg.value = errText(e)
    progress.value = null
  } finally {
    exporting.value = false
  }
}

function back(): void {
  if (docStore.id) {
    app.view = 'workbench'
  } else {
    app.toLibrary()
  }
}

function toggleAllPages(on: boolean): void {
  options.pageIndices = on ? pages.value.map((p) => p.index) : []
}

function togglePage(i: number): void {
  const idx = options.pageIndices.indexOf(i)
  if (idx >= 0) options.pageIndices.splice(idx, 1)
  else options.pageIndices.push(i)
}
</script>

<template>
  <div class="export-view">
    <header class="wb-header">
      <button class="btn ghost" @click="back">← 返回</button>
      <strong>导出中心</strong>
    </header>

    <div class="export-body">
      <main class="export-preview">
        <ExportPreviewGrid
          v-if="bundle"
          :bundle="bundle"
          :mode="galleryMode"
          :range="options.range"
          :chapter-ids="options.chapterIds"
          :selectable="options.range === 'pages'"
          :selected="options.pageIndices"
          @toggle="togglePage"
        />
        <div v-else-if="loadingBundle" class="empty">加载中…</div>
        <div v-else class="empty">未打开文档：请先在文档库中打开一篇文档，再进入导出中心。</div>
      </main>

      <aside class="export-opts">
        <section class="sp-group">
          <span class="sp-label">导出文档</span>
          <strong class="ex-doc-title">{{ bundle?.meta.title || '未打开文档' }}</strong>
        </section>

        <section class="sp-group">
          <span class="sp-label">导出范围</span>
          <div class="ex-row">
            <label class="check">
              <input v-model="options.range" type="radio" value="all" />
              全文
            </label>
            <label class="check">
              <input v-model="options.range" type="radio" value="chapters" />
              部分章节
            </label>
            <label class="check" :title="isInfinite ? '画布为无限长图，没有分页概念' : ''">
              <input v-model="options.range" type="radio" value="pages" :disabled="isInfinite" />
              部分页
            </label>
          </div>
          <div v-if="options.range === 'chapters'" class="ex-chapters">
            <label v-for="c in chapters" :key="c.id" class="check">
              <input v-model="options.chapterIds" type="checkbox" :value="c.id" />
              {{ c.title }}
            </label>
            <p v-if="!chapters.length" class="muted" style="font-size: 12px">
              未检测到章节，请先在写作模式中插入章节符或启用自动分割。
            </p>
          </div>
          <div v-if="options.range === 'pages'" class="ex-chapters">
            <div class="ex-row">
              <button class="btn small" @click="toggleAllPages(true)">全选</button>
              <button class="btn small" @click="toggleAllPages(false)">清空</button>
              <span class="muted ex-hint">已选 {{ options.pageIndices.length }} / {{ pages.length }}</span>
            </div>
            <label v-for="p in pages" :key="p.index" class="check">
              <input v-model="options.pageIndices" type="checkbox" :value="p.index" />
              {{ pageLabel(p) }}
            </label>
          </div>
        </section>

        <section class="sp-group">
          <span class="sp-label">导出形式</span>
          <select v-model="options.format" class="input">
            <option v-for="f in formatItems" :key="f.value" :value="f.value">
              {{ f.label }}
            </option>
          </select>
          <p class="muted ex-hint">{{ formatHint }}</p>
          <p v-if="options.range !== 'all' && rangePages.length" class="muted ex-hint">
            当前范围：{{ options.range === 'chapters' ? `${options.chapterIds.length} 章` : `${options.pageIndices.length} 页`
            }}{{ zipped ? '，分单元导出会打包成 ZIP' : '，合成为 1 个文件' }}
          </p>
          <p v-if="options.range !== 'all' && !rangePages.length" class="ex-warn">
            请先在上方勾选要导出的{{ options.range === 'chapters' ? '章节' : '页' }}。
          </p>
        </section>

        <section class="sp-group">
          <span class="sp-label">清晰度</span>
          <div class="ex-row">
            <label v-for="q in QUALITY_OPTIONS" :key="q.value" class="check" :title="q.hint">
              <input v-model="options.quality" type="radio" :value="q.value" />
              {{ q.label }}
            </label>
          </div>
          <p class="muted ex-hint">{{ qualityHint }}</p>
          <p v-if="compressWarn" class="ex-warn">{{ compressWarn }}</p>
        </section>

        <section class="sp-group">
          <span class="sp-label">输出目录</span>
          <div class="ex-row">
            <button class="btn small" @click="pickOutputDir">选择目录</button>
            <input v-model="options.outputDir" class="input ex-dir-input" placeholder="或直接粘贴路径" />
          </div>
        </section>

        <section class="sp-group">
          <button class="btn" :disabled="!bundle || checking" @click="runChecks">
            {{ checking ? '检查中…' : '运行导出检查' }}
          </button>
          <div v-if="checks" class="ex-checks">
            <p v-for="(w, i) in checks.warns" :key="'w' + i" class="ex-warn">⚠ {{ w }}</p>
            <p v-for="(info, i) in checks.infos" :key="'i' + i" class="ex-info">ℹ {{ info }}</p>
            <p v-if="!checks.warns.length && !checks.infos.length" class="ex-info">
              ✓ 未发现问题，可以导出。
            </p>
          </div>
          <p v-if="errorMsg && !exporting" class="ex-warn">✗ {{ errorMsg }}</p>
        </section>

        <section class="sp-group">
          <div class="ex-row">
            <button class="btn primary" :disabled="!canExport" @click="startExport">
              {{ exporting ? '导出中…' : '开始导出' }}
            </button>
            <span class="muted ex-hint">{{ sizeEstimate }}</span>
          </div>
          <div v-if="progress" class="ex-progress">
            <div class="ex-bar">
              <div
                class="ex-bar-fill"
                :style="{ width: progress.total ? `${(progress.done / progress.total) * 100}%` : '10%' }"
              />
            </div>
            <p class="muted" style="font-size: 12px">{{ progress.message }}</p>
          </div>
          <div v-if="resultFiles.length" class="ex-result">
            <p class="ex-info">✓ 已输出到 {{ resultDir }}（实际 {{ formatBytes(resultBytes) }}）</p>
            <p v-for="f in resultFiles" :key="f" class="ex-file">{{ f }}</p>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.export-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.export-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.export-opts {
  width: 330px;
  flex-shrink: 0;
  background: var(--panel);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

/* 侧栏只做行距调整：控件、文案、顺序一律不变 */
.sp-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ex-doc-title {
  display: block;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ex-row {
  display: flex;
  gap: 16px;
  row-gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.ex-chapters {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--panel-soft);
  border: 1px solid var(--border);
  border-radius: 8px;
  max-height: 180px;
  overflow-y: auto;
}

.ex-hint {
  font-size: 11px;
  line-height: 1.7;
}

.ex-dir-input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
}

.ex-checks {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
  line-height: 1.7;
}

.ex-warn {
  color: var(--danger);
  font-size: 12px;
  line-height: 1.7;
}

.ex-info {
  color: var(--ink-soft);
}

.ex-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ex-bar {
  height: 6px;
  background: var(--panel-soft);
  border-radius: 999px;
  overflow: hidden;
}

.ex-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
  transition: width 0.2s;
}

.ex-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 140px;
  overflow-y: auto;
}

.ex-file {
  font-size: 11px;
  color: var(--muted);
  font-family: Consolas, monospace;
  line-height: 1.7;
  word-break: break-all;
}

.ex-chapters .check {
  line-height: 1.6;
}

.export-preview {
  flex: 1;
  min-width: 0;
  display: flex;
}
</style>
