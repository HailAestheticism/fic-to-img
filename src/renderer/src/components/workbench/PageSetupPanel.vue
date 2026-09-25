<script setup lang="ts">
/**
 * 页面设置：画布大小（印刷品 / 显示器 / 自定义 三行按键 + mm·px 四框联动 + 横向开关）、
 * 页边距、页眉/页脚（居左/居中/居右、页码、中文字号↔磅联动）。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { AlignKind, CustomCanvas, PageSetup, Typography } from '@shared/types'
import { CANVAS_PRESETS, canvasPatch, customToPreset, findPreset, mmToPx, pxToMm } from '@shared/paper'
import type { CanvasPreset } from '@shared/paper'
import { api } from '../../api'
import { genId } from '../../editor/id'
import FontSizeField from '../common/FontSizeField.vue'

const props = defineProps<{
  pageSetup: PageSetup
  typography: Typography
  /** 折叠卡片包裹时标题由卡片渲染 */
  hideHead?: boolean
}>()
const emit = defineEmits<{
  (e: 'update', pageSetup: PageSetup): void
  (e: 'updatePaper', payload: { pageSetup: PageSetup; typography: Typography }): void
}>()

const form = reactive<PageSetup>(JSON.parse(JSON.stringify(props.pageSetup)))
let selfEcho = false

watch(
  () => props.pageSetup,
  (ps) => {
    if (selfEcho) {
      selfEcho = false
      return
    }
    if (JSON.stringify(ps) !== JSON.stringify(form)) {
      Object.assign(form, JSON.parse(JSON.stringify(ps)))
      syncBoxes()
    }
  },
  { deep: true }
)

/** 印刷品行只展示这五个常用规格（顺序即展示顺序）；目录里其余尺寸仍供旧文档命中高亮/标签用 */
const PRINT_KEYS = ['A4', 'A5', 'B5', 'k16', 'k32'] as const
const PRINT_PRESETS = PRINT_KEYS.map(
  (k) => CANVAS_PRESETS.find((p) => p.key === k) as CanvasPreset
).filter((p) => !!p)
const SCREEN_PRESETS = CANVAS_PRESETS.filter((p) => p.group === 'screen')

const currentKey = computed(
  () => findPreset(form.widthMm, form.heightMm, form.infiniteHeight === true)?.key ?? ''
)

// ---------- 自定义画布尺寸（settings.json 持久化，全局共享） ----------

const customList = ref<CustomCanvas[]>([])

onMounted(async () => {
  try {
    const s = await api.settings.get()
    customList.value = s.customCanvases ?? []
  } catch {
    customList.value = []
  }
})

async function persistCustom(): Promise<void> {
  try {
    await api.settings.set({ customCanvases: customList.value })
  } catch {
    /* 写盘失败不打断界面操作 */
  }
}

/** 未命中预设目录时，按尺寸（±0.6mm）回看自定义列表 */
const activeCustomId = computed(() => {
  if (currentKey.value) return ''
  const hit = customList.value.find((c) => {
    if (!!c.infiniteHeight !== (form.infiniteHeight === true)) return false
    if (Math.abs(c.widthMm - form.widthMm) >= 0.6) return false
    return c.infiniteHeight || Math.abs(c.heightMm - form.heightMm) < 0.6
  })
  return hit?.id ?? ''
})

function nextCustomLabel(): string {
  const used = new Set(customList.value.map((c) => c.label))
  let n = 1
  while (used.has(`自定义尺寸${n}`)) n += 1
  return `自定义尺寸${n}`
}

function saveCustom(): void {
  if (activeCustomId.value) return
  customList.value = [
    ...customList.value,
    {
      id: genId(),
      label: nextCustomLabel(),
      widthMm: form.widthMm,
      heightMm: form.heightMm,
      ...(form.infiniteHeight ? { infiniteHeight: true } : {}),
      margins: {
        top: form.marginTopMm,
        right: form.marginRightMm,
        bottom: form.marginBottomMm,
        left: form.marginLeftMm
      }
    }
  ]
  void persistCustom()
}

function applyCustom(c: CustomCanvas): void {
  const patch = canvasPatch(
    customToPreset(c),
    JSON.parse(JSON.stringify(form)),
    props.typography
  )
  Object.assign(form, patch.pageSetup)
  selfEcho = true
  syncBoxes()
  emit('updatePaper', patch)
}

function removeCustom(c: CustomCanvas): void {
  customList.value = customList.value.filter((x) => x.id !== c.id)
  void persistCustom()
}

function presetTitle(p: CanvasPreset): string {
  return p.infiniteHeight
    ? `${p.label}：宽 ${p.widthMm} mm × 无限`
    : `${p.label}：${Math.round(p.widthMm)}×${Math.round(p.heightMm ?? 0)} mm`
}

function customTitle(c: CustomCanvas): string {
  return c.infiniteHeight
    ? `${c.label}：宽 ${Math.round(c.widthMm)} mm × 无限`
    : `${c.label}：${Math.round(c.widthMm)}×${Math.round(c.heightMm)} mm`
}

const ALIGNS: { value: AlignKind; label: string }[] = [
  { value: 'left', label: '居左' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '居右' }
]

function setCanvas(p: CanvasPreset): void {
  const patch = canvasPatch(p, JSON.parse(JSON.stringify(form)), props.typography)
  Object.assign(form, patch.pageSetup)
  selfEcho = true
  syncBoxes()
  emit('updatePaper', patch)
}

function push(): void {
  syncBoxes()
  emit('update', JSON.parse(JSON.stringify(form)))
}

// ---------- 宽高：mm 与 px 四框联动 ----------

const wMm = ref('')
const wPx = ref('')
const hMm = ref('')
const hPx = ref('')

/** 存储约定：widthMm 恒为固定边，heightMm 为长边（无限长度时仅作占位） */
const infiniteIsWidth = computed(() => form.infiniteHeight === true && form.landscape === true)

function edgeMm(which: 'w' | 'h'): number | null {
  const infiniteEdge = which === 'w' ? infiniteIsWidth.value : !infiniteIsWidth.value
  if (form.infiniteHeight && infiniteEdge) return null
  const storedWidth = which === 'w' ? !form.landscape : !!form.landscape
  return storedWidth ? form.widthMm : form.heightMm
}

function setEdgeMm(which: 'w' | 'h', mm: number): void {
  const storedWidth = which === 'w' ? !form.landscape : !!form.landscape
  if (storedWidth) form.widthMm = mm
  else form.heightMm = mm
}

const r2 = (v: number): number => Math.round(v * 100) / 100

function syncBoxes(): void {
  const w = edgeMm('w')
  const h = edgeMm('h')
  wMm.value = w === null ? '--' : String(r2(w))
  wPx.value = w === null ? '--' : String(Math.round(mmToPx(w)))
  hMm.value = h === null ? '--' : String(r2(h))
  hPx.value = h === null ? '--' : String(Math.round(mmToPx(h)))
}

function applyMm(which: 'w' | 'h', raw: string): void {
  const v = Number(raw)
  if (!isFinite(v) || v <= 0) {
    syncBoxes()
    return
  }
  const land = which === 'w' ? 30 : 20
  const hi = which === 'w' ? 1200 : 5000
  setEdgeMm(which, Math.max(land, Math.min(hi, r2(v))))
  push()
}

function applyPx(which: 'w' | 'h', raw: string): void {
  const v = Number(raw)
  if (!isFinite(v) || v <= 0) {
    syncBoxes()
    return
  }
  applyMm(which, String(pxToMm(v)))
}

function toggleLandscape(): void {
  form.landscape = !form.landscape
  push()
}

// ---------- 页边距 ----------

const MARGIN_ROWS = [
  [
    { k: 'marginTopMm', l: '上' },
    { k: 'marginBottomMm', l: '下' }
  ],
  [
    { k: 'marginLeftMm', l: '左' },
    { k: 'marginRightMm', l: '右' }
  ]
] as const

function onMargin(key: string, raw: string): void {
  const v = Number(raw)
  const rec = form as unknown as Record<string, number>
  rec[key] = Math.max(0, Math.min(120, isFinite(v) && v > 0 ? r2(v) : 0))
  push()
}

/** 页码位置：未设置时跟随页脚对齐 */
const pageAlign = computed<AlignKind>({
  get: () => form.footer.pageNumberAlign ?? form.footer.align,
  set: (v) => {
    form.footer.pageNumberAlign = v
  }
})

syncBoxes()
</script>

<template>
  <aside class="setup-panel">
    <header v-if="!props.hideHead" class="sp-head">页面设置</header>

    <section class="sp-group">
      <span class="sp-label">画布大小</span>

      <p class="sp-parent-label">印刷品</p>
      <div class="sp-chips">
        <button
          v-for="p in PRINT_PRESETS"
          :key="p.key"
          class="btn small sp-chip"
          :class="{ active: currentKey === p.key }"
          :title="presetTitle(p)"
          @click="setCanvas(p)"
        >
          {{ p.label }}
        </button>
      </div>

      <p class="sp-parent-label">显示器</p>
      <div class="sp-chips">
        <button
          v-for="p in SCREEN_PRESETS"
          :key="p.key"
          class="btn small sp-chip"
          :class="{ active: currentKey === p.key }"
          :title="presetTitle(p)"
          @click="setCanvas(p)"
        >
          {{ p.label }}
        </button>
      </div>

      <div class="sp-custom-head">
        <p class="sp-parent-label">自定义</p>
        <button
          class="btn small"
          :disabled="!!activeCustomId"
          :title="activeCustomId ? '当前尺寸已在自定义列表中' : '把当前宽高与页边距存为自定义尺寸'"
          @click="saveCustom"
        >
          {{ activeCustomId ? '已保存当前尺寸' : '保存当前尺寸到自定义' }}
        </button>
      </div>
      <div v-if="customList.length" class="sp-chips">
        <span v-for="c in customList" :key="c.id" class="sp-custom-item">
          <button
            class="btn small sp-chip"
            :class="{ active: activeCustomId === c.id }"
            :title="customTitle(c)"
            @click="applyCustom(c)"
          >
            {{ c.label }}
          </button>
          <button class="sp-chip-del" title="从自定义列表移除" @click="removeCustom(c)">×</button>
        </span>
      </div>
      <p v-else class="sp-hint">暂无自定义尺寸，调好宽高后点上方按钮保存</p>
      <p class="sp-hint">选择画布会同步套用推荐页边距（部分画布另调正文字号）</p>

      <div class="sp-size">
        <label class="sp-field">
          <span>宽 mm</span>
          <input v-model="wMm" class="input" @change="applyMm('w', wMm)" />
        </label>
        <label class="sp-field">
          <span>宽 px</span>
          <input v-model="wPx" class="input" @change="applyPx('w', wPx)" />
        </label>
        <label class="sp-field">
          <span>高 mm</span>
          <input v-model="hMm" class="input" @change="applyMm('h', hMm)" />
        </label>
        <label class="sp-field">
          <span>高 px</span>
          <input v-model="hPx" class="input" @change="applyPx('h', hPx)" />
        </label>
      </div>
      <div class="sp-row">
        <button
          class="btn small"
          :class="{ active: form.landscape }"
          title="画布横向与「竖向排列」绑定：横向即全文竖排（图片表格除外）"
          @click="toggleLandscape"
        >
          画布横向 {{ form.landscape ? '开' : '关' }}
        </button>
        <span v-if="form.infiniteHeight" class="sp-hint">「--」为随文本增长的无限边</span>
      </div>
    </section>

    <section class="sp-group">
      <span class="sp-label">页边距 mm</span>
      <div v-for="(row, ri) in MARGIN_ROWS" :key="ri" class="sp-row two">
        <label v-for="m in row" :key="m.k" class="sp-field">
          <span>{{ m.l }}</span>
          <input
            class="input"
            type="number"
            min="0"
            max="120"
            :value="form[m.k]"
            @change="onMargin(m.k, ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
    </section>

    <section class="sp-group">
      <label class="sp-check">
        <input v-model="form.header.enabled" type="checkbox" @change="push" />
        页眉
      </label>
      <template v-if="form.header.enabled">
        <input
          v-model="form.header.text"
          class="input"
          placeholder="支持 {title} {chapter} {page} {total}"
          @change="push"
        />
        <div class="sp-line">
          <select v-model="form.header.align" class="input sp-align" @change="push">
            <option v-for="a in ALIGNS" :key="a.value" :value="a.value">{{ a.label }}</option>
          </select>
          <FontSizeField
            :model-value="form.header.fontSize"
            :min="5"
            :max="40"
            @update:model-value="
              (v: number) => {
                form.header.fontSize = v
                push()
              }
            "
          />
        </div>
      </template>
    </section>

    <section class="sp-group">
      <label class="sp-check">
        <input v-model="form.footer.enabled" type="checkbox" @change="push" />
        页脚
      </label>
      <template v-if="form.footer.enabled">
        <input
          v-model="form.footer.text"
          class="input"
          placeholder="页脚文字，支持 {title} {chapter}"
          @change="push"
        />
        <div class="sp-line">
          <select v-model="form.footer.align" class="input sp-align" @change="push">
            <option v-for="a in ALIGNS" :key="a.value" :value="a.value">{{ a.label }}</option>
          </select>
          <FontSizeField
            :model-value="form.footer.fontSize"
            :min="5"
            :max="40"
            @update:model-value="
              (v: number) => {
                form.footer.fontSize = v
                push()
              }
            "
          />
        </div>
        <div class="sp-line">
          <label class="sp-check">
            <input v-model="form.footer.showPageNumber" type="checkbox" @change="push" />
            页码
          </label>
          <input
            v-if="form.footer.showPageNumber"
            v-model="form.footer.pageNumberFormat"
            class="input sp-format"
            placeholder="{page} / {total}"
            @change="push"
          />
        </div>
        <div v-if="form.footer.showPageNumber" class="sp-line">
          <select v-model="pageAlign" class="input sp-align" title="页码位置" @change="push">
            <option v-for="a in ALIGNS" :key="a.value" :value="a.value">{{ a.label }}</option>
          </select>
          <FontSizeField
            :model-value="form.footer.pageNumberFontSize ?? form.footer.fontSize"
            :min="5"
            :max="40"
            @update:model-value="
              (v: number) => {
                form.footer.pageNumberFontSize = v
                push()
              }
            "
          />
        </div>
      </template>
    </section>
  </aside>
</template>

<style scoped>
.setup-panel {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sp-head {
  font-size: 13px;
  font-weight: 600;
}

.sp-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sp-label {
  font-size: 12px;
  color: var(--muted);
}

.sp-parent-label {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ink);
}

.sp-custom-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}

.sp-custom-item {
  display: inline-flex;
  align-items: center;
  gap: 1px;
}

.sp-chip-del {
  border: none;
  background: none;
  color: var(--muted);
  font-size: 13px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
}

.sp-chip-del:hover {
  color: var(--danger, #c0392b);
}

.sp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.sp-chip.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.sp-hint {
  margin: 0;
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}

.sp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sp-row.two {
  justify-content: space-between;
}

.sp-row.two > * {
  flex: 1;
}

.sp-line {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.sp-size {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}

.sp-field {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 11px;
  color: var(--muted);
}

.sp-field > span {
  width: 38px;
  flex-shrink: 0;
}

.sp-field .input {
  flex: 1;
  width: 100%;
  min-width: 0;
  padding: 3px 5px;
  font-size: 12px;
}

.sp-align {
  width: 58px;
  flex-shrink: 0;
  padding: 3px 4px;
  font-size: 11px;
}

.sp-check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
}
</style>
