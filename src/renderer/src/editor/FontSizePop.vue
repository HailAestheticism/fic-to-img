<script setup lang="ts">
/** 字号浮窗：磅值 ↔ 中文字号 双向换算 */
import { ref } from 'vue'
import { cnNameToPt, parseSizeToPt, ptToCnName } from './format-units'

const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ (e: 'apply', value: string | null): void }>()

const initPt = parseSizeToPt(props.modelValue)
const ptText = ref(initPt !== null ? String(initPt) : '')
const cnText = ref(initPt !== null ? ptToCnName(initPt) || '--' : '')

function applyPt(pt: number): void {
  emit('apply', `${pt}pt`)
}

function onPtChange(e: Event): void {
  const raw = (e.target as HTMLInputElement).value
  if (!raw.trim()) {
    ptText.value = ''
    cnText.value = ''
    return
  }
  let n = Number(raw)
  if (!isFinite(n) || n <= 0) n = 12
  n = Math.max(1, Math.min(400, n))
  n = Math.round(n * 2) / 2
  ptText.value = String(n)
  cnText.value = ptToCnName(n) || '--'
  applyPt(n)
}

function onCnChange(e: Event): void {
  const name = (e.target as HTMLInputElement).value.trim()
  const pt = cnNameToPt(name)
  if (pt === null) {
    // 非法名称：回填当前磅值对应的显示
    cnText.value = ptText.value ? ptToCnName(Number(ptText.value)) || '--' : ''
    return
  }
  cnText.value = name
  ptText.value = String(pt)
  applyPt(pt)
}
</script>

<template>
  <div class="fsz-pop">
    <div class="tb-pop-row">
      <label>磅（pt）</label>
      <input class="tb-pop-input" type="number" step="0.5" min="1" :value="ptText" @change="onPtChange" />
    </div>
    <div class="tb-pop-row">
      <label>中文字号</label>
      <input class="tb-pop-input" :value="cnText" placeholder="--" spellcheck="false" @change="onCnChange" />
    </div>
    <div class="tb-pop-row">
      <span class="fsz-hint">可选：初号～八号（含小字级）</span>
      <button class="tb-btn small" style="margin-left: auto" @click="emit('apply', null)">清除</button>
    </div>
  </div>
</template>

<style>
.fsz-pop {
  width: 200px;
}

.fsz-hint {
  color: var(--muted);
  font-size: 11px;
}
</style>
