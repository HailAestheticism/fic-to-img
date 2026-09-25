<script setup lang="ts">
/**
 * 缩进浮窗：左/右侧、首行/悬挂缩进。
 * 输入整数（磅）或「[整数]字符」（按正文字号折合成磅）；上限为页面版心宽度的一半（不含）。
 */
import { computed, ref } from 'vue'
import { useDocStore } from '../stores/doc'
import { PT_PER_MM, pxToPt } from './format-units'

const props = defineProps<{
  indentLeft: string | null
  indentRight: string | null
  textIndent: string | null
}>()
const emit = defineEmits<{
  (
    e: 'apply',
    patch: { indentLeft: string | null; indentRight: string | null; textIndent: string | null }
  ): void
}>()

const doc = useDocStore()

const bodyPt = computed(() => pxToPt(doc.layout?.typography.bodySize ?? 16))

/** 版心宽度（页宽 - 左右边距）的一半，输入须小于该值 */
const maxPt = computed(() => {
  const ps = doc.layout?.pageSetup
  if (!ps) return 200
  const contentPt = (ps.widthMm - ps.marginLeftMm - ps.marginRightMm) * PT_PER_MM
  return Math.max(1, Math.ceil(contentPt / 2) - 1)
})

function toPt(raw: string | null): number {
  if (!raw) return 0
  const v = parseFloat(raw)
  if (!isFinite(v)) return 0
  if (raw.includes('em')) return v * bodyPt.value
  if (raw.includes('px')) return pxToPt(v)
  return v
}

/** 解析输入：整数=磅；“N字符”按正文字号换算；四舍五入取整并夹紧到上限 */
function parseField(text: string): number | null {
  const t = text.trim()
  if (!t) return null
  const m = /^(\d+(?:\.\d+)?)\s*(字符|字|chars?)$/i.exec(t)
  let n: number
  if (m) n = Number(m[1]) * bodyPt.value
  else {
    n = Number(t)
    if (!isFinite(n) || n < 0) return null
  }
  n = Math.round(n)
  return Math.min(n, maxPt.value)
}

function parseDisplay(text: string): number {
  return parseField(text) ?? 0
}

const ti = toPt(props.textIndent)
const initHanging = Math.max(0, -ti)
const left = ref(String(Math.max(0, Math.round(toPt(props.indentLeft) - initHanging))))
const right = ref(toPt(props.indentRight) ? String(Math.round(toPt(props.indentRight))) : '')
const first = ref(ti > 0 ? String(Math.round(ti)) : '')
const hanging = ref(initHanging > 0 ? String(Math.round(initHanging)) : '')

function push(): void {
  const l = parseDisplay(left.value)
  const r = parseDisplay(right.value)
  const f = parseDisplay(first.value)
  const h = parseDisplay(hanging.value)
  // 首行与悬挂互斥：以最后修改者为准由调用方保证，这里首行优先
  const effectiveHanging = f > 0 ? 0 : h
  left.value = String(l)
  right.value = r ? String(r) : ''
  first.value = f ? String(f) : (effectiveHanging ? '' : first.value)
  hanging.value = effectiveHanging ? String(effectiveHanging) : ''
  emit('apply', {
    indentLeft: l + effectiveHanging ? `${l + effectiveHanging}pt` : null,
    indentRight: r ? `${r}pt` : null,
    textIndent: f ? `${f}pt` : effectiveHanging ? `-${effectiveHanging}pt` : null
  })
}

const fields = { left, right, first, hanging } as const
type FieldName = keyof typeof fields

function onField(name: FieldName, e: Event): void {
  const field = fields[name]
  field.value = (e.target as HTMLInputElement).value
  // 首行与悬挂互斥：以最后修改者为准
  if (name === 'first' && parseDisplay(first.value) > 0) hanging.value = ''
  if (name === 'hanging' && parseDisplay(hanging.value) > 0) first.value = ''
  push()
}
</script>

<template>
  <div class="idp-pop">
    <div class="tb-pop-row">
      <label>左侧</label>
      <input class="tb-pop-input" :value="left" placeholder="0" @change="onField('left', $event)" />
      <label>右侧</label>
      <input class="tb-pop-input" :value="right" placeholder="0" @change="onField('right', $event)" />
    </div>
    <div class="tb-pop-row">
      <label>首行</label>
      <input class="tb-pop-input" :value="first" placeholder="0" @change="onField('first', $event)" />
      <label>悬挂</label>
      <input class="tb-pop-input" :value="hanging" placeholder="0" @change="onField('hanging', $event)" />
    </div>
    <p class="idp-hint">单位：磅或“整数字符”（按正文字号折算）；上限 {{ maxPt }} 磅</p>
  </div>
</template>

<style>
.idp-pop {
  width: 240px;
}

.idp-pop .tb-pop-row > label {
  width: 26px;
}

.idp-hint {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 11px;
}
</style>
