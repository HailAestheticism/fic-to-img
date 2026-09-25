<script setup lang="ts">
/**
 * 调色盘浮窗：SV 面板 + 色相条 + RGB/HEX 输入 + 默认色板 + 10 个自定义色位。
 * 文本颜色与填充颜色各挂一个实例（v-if），recent 记录按 kind 隔离存 localStorage。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { hsvToRgb, parseColor, rgbToHex, rgbToHsv } from './format-units'
import type { Rgb } from './format-units'

const props = defineProps<{ kind: 'text' | 'fill'; modelValue: string | null }>()
const emit = defineEmits<{
  (e: 'apply', color: string): void
  (e: 'clear'): void
}>()

const TEXT_SWATCHES = [
  '#2f2a26',
  '#b3402f',
  '#c96f1f',
  '#8a6d3b',
  '#4a7c59',
  '#2b6cb0',
  '#6b46c1',
  '#96897c',
  '#ffffff'
]

/** 取自古典/柔彩荧光笔套装的常见 8 色笔迹（高明度、中低饱和）+ 浅灰 */
const FILL_SWATCHES = [
  '#fff284',
  '#ffdca6',
  '#ffb59e',
  '#ffc3d4',
  '#c7f0c0',
  '#aee0f7',
  '#a3e8dc',
  '#dcc9f3',
  '#e5e5e1'
]

const swatches = computed(() => (props.kind === 'fill' ? FILL_SWATCHES : TEXT_SWATCHES))

const RECENT_SLOTS = 10
const LS_KEY = `fictoimg.recentColors.${props.kind}`

function loadRecent(): string[] {
  try {
    const a: unknown = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string').slice(0, RECENT_SLOTS) : []
  } catch {
    return []
  }
}

const recent = ref<string[]>(loadRecent())

/** 关闭浮窗时：本次通过调色盘/输入框选中的颜色视作一次颜色设定 */
function commitRecent(): void {
  const c = picked
  if (!c) return
  const list = [c, ...recent.value.filter((x) => x !== c)].slice(0, RECENT_SLOTS)
  recent.value = list
  localStorage.setItem(LS_KEY, JSON.stringify(list))
}

const startRgb = parseColor(props.modelValue || '') ?? { r: 47, g: 42, b: 38 }
const hsv = ref(rgbToHsv(startRgb))
const hex = ref(rgbToHex(startRgb))
let picked: string | null = null

const rgbFields = computed<Rgb>(() => {
  const c = parseColor(hex.value)
  return c ? { r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) } : startRgb
})

const mode = ref<'rgb' | 'hex'>('hex')

/** 色板悬停提示跟随输入模式：rgb 模式下显示 rgb() 值，与色板预览一致 */
function swatchLabel(c: string): string {
  if (mode.value !== 'rgb') return c
  const p = parseColor(c)
  return p ? `rgb(${Math.round(p.r)}, ${Math.round(p.g)}, ${Math.round(p.b)})` : c
}

function syncFromHsv(): void {
  hex.value = rgbToHex(hsvToRgb(hsv.value))
}

function setFromRgb(c: Rgb): void {
  hex.value = rgbToHex(c)
  hsv.value = rgbToHsv(parseColor(hex.value) ?? c)
}

function setFromHex(v: string): void {
  const c = parseColor(v)
  if (c) setFromRgb(c)
}

function apply(fromPicker: boolean): void {
  emit('apply', hex.value)
  if (fromPicker) picked = hex.value
}

const svEl = ref<HTMLElement | null>(null)
const hueEl = ref<HTMLElement | null>(null)

const svBg = computed(() => `hsl(${Math.round(hsv.value.h)}, 100%, 50%)`)
const markerPos = computed(() => ({
  left: `${(hsv.value.s * 100).toFixed(1)}%`,
  top: `${((1 - hsv.value.v) * 100).toFixed(1)}%`
}))

function dragHandler(el: () => HTMLElement | null, onPos: (fx: number, fy: number) => void) {
  return (e: PointerEvent): void => {
    const node = el()
    if (!node) return
    node.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent | MouseEvent): void => {
      const r = node.getBoundingClientRect()
      onPos(
        Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)),
        Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))
      )
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      apply(true)
    }
    move(e)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
}

const onSvDown = dragHandler(
  () => svEl.value,
  (fx, fy) => {
    hsv.value = { ...hsv.value, s: fx, v: 1 - fy }
    syncFromHsv()
  }
)

const onHueDown = dragHandler(
  () => hueEl.value,
  (fx) => {
    hsv.value = { ...hsv.value, h: fx * 360 }
    syncFromHsv()
  }
)

function pickRg(idx: 'r' | 'g' | 'b', v: string): void {
  const n = Math.max(0, Math.min(255, Math.round(Number(v) || 0)))
  setFromRgb({ ...rgbFields.value, [idx]: n })
  apply(true)
}

function rgbInputProps(idx: 'r' | 'g' | 'b') {
  return {
    value: String(rgbFields.value[idx]),
    onChange: (e: Event) => pickRg(idx, (e.target as HTMLInputElement).value)
  }
}

const hexDraft = ref(hex.value)
// 默认即 hex 输入框：拖调色盘/取色时要回显最新值
watch(hex, (v) => {
  hexDraft.value = v
})

function commitHex(): void {
  setFromHex(hexDraft.value)
  hexDraft.value = hex.value
  apply(true)
}

function pickSwatch(c: string): void {
  setFromHex(c)
  emit('apply', c)
}

onBeforeUnmount(commitRecent)
</script>

<template>
  <div class="cp">
    <div
      ref="svEl"
      class="cp-sv"
      :style="{ backgroundColor: svBg }"
      @pointerdown.prevent="onSvDown"
    >
      <span class="cp-marker" :style="markerPos" />
    </div>
    <div ref="hueEl" class="cp-hue" @pointerdown.prevent="onHueDown" />

    <div class="cp-row">
      <button class="tb-btn small cp-mode-toggle" @click="mode = mode === 'rgb' ? 'hex' : 'rgb'">
        {{ mode === 'rgb' ? 'RGB' : 'HEX' }}
      </button>
      <template v-if="mode === 'rgb'">
        <input class="cp-input" type="number" min="0" max="255" v-bind="rgbInputProps('r')" />
        <input class="cp-input" type="number" min="0" max="255" v-bind="rgbInputProps('g')" />
        <input class="cp-input" type="number" min="0" max="255" v-bind="rgbInputProps('b')" />
      </template>
      <input
        v-else
        class="cp-input cp-hex"
        v-model="hexDraft"
        spellcheck="false"
        @change="commitHex"
        @keydown.enter="commitHex"
      />
      <span class="cp-preview" :style="{ background: hex }" />
    </div>

    <div class="cp-swatches">
      <button
        v-for="c in swatches"
        :key="c"
        class="cp-swatch"
        :style="{ background: c }"
        :title="swatchLabel(c)"
        @click="pickSwatch(c)"
      />
      <button class="tb-btn small" title="恢复默认颜色" @click="emit('clear')">⌫</button>
    </div>

    <div class="cp-swatches cp-recent">
      <button
        v-for="i in RECENT_SLOTS"
        :key="i"
        class="cp-swatch"
        :class="{ empty: !recent[i - 1] }"
        :style="recent[i - 1] ? { background: recent[i - 1] } : undefined"
        :title="recent[i - 1] ? swatchLabel(recent[i - 1]) : '暂无自定义颜色'"
        :disabled="!recent[i - 1]"
        @click="recent[i - 1] && pickSwatch(recent[i - 1])"
      />
    </div>
  </div>
</template>

<style>
.cp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 216px;
}

.cp-sv {
  position: relative;
  height: 120px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background-image:
    linear-gradient(to right, #fff, rgba(255, 255, 255, 0)),
    linear-gradient(to top, #000, rgba(0, 0, 0, 0));
  cursor: crosshair;
  touch-action: none;
}

.cp-marker {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 2px solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 35%);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.cp-hue {
  height: 10px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background-image: linear-gradient(
    to right,
    #f00,
    #ff0,
    #0f0,
    #0ff,
    #00f,
    #f0f,
    #f00
  );
  cursor: pointer;
  touch-action: none;
}

.cp-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cp-mode-toggle,
.tb-btn.cp-mode-toggle {
  height: 22px;
  min-width: 0;
  padding: 0 6px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 5px;
}

.cp-input {
  height: 22px;
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--panel);
  color: var(--ink);
  font-size: 11px;
  padding: 0 4px;
}

.cp-input:focus {
  outline: none;
  border-color: var(--accent);
}

.cp-input.cp-hex {
  flex: 1;
}

.cp-preview {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  border: 1px solid var(--border);
  flex-shrink: 0;
}

.cp-swatches {
  display: flex;
  align-items: center;
  gap: 4px;
}

.cp-swatches .tb-btn {
  height: 22px;
  min-width: 0;
  padding: 0 6px;
  font-size: 11px;
}

.cp-swatch {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid rgb(47 42 38 / 15%);
  cursor: pointer;
  padding: 0;
}

.cp-swatch:hover {
  transform: scale(1.15);
}

.cp-swatch.empty {
  background: var(--panel);
  border-style: dashed;
  border-color: var(--border-strong);
  cursor: default;
}

.cp-swatch.empty:hover {
  transform: none;
}

.cp-recent {
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
</style>
