<script setup lang="ts">
/** 段间距浮窗：段前 / 段后（磅，整数） */
import { ref } from 'vue'

const props = defineProps<{ before: string | null; after: string | null }>()
const emit = defineEmits<{ (e: 'apply', patch: { before: string | null; after: string | null }): void }>()

function initPt(raw: string | null): string {
  if (!raw) return ''
  const v = parseFloat(raw)
  if (!isFinite(v) || v <= 0) return ''
  if (raw.includes('px')) return String(Math.round(v * 0.75))
  return String(Math.round(v))
}

const beforeText = ref(initPt(props.before))
const afterText = ref(initPt(props.after))

function norm(text: string | number): string | null {
  const s = String(text).trim()
  if (!s) return null
  const n = Math.max(0, Math.min(220, Math.round(Number(s)) || 0))
  return `${n}pt`
}

function push(): void {
  beforeText.value = norm(beforeText.value)?.replace('pt', '') ?? ''
  afterText.value = norm(afterText.value)?.replace('pt', '') ?? ''
  emit('apply', { before: norm(beforeText.value), after: norm(afterText.value) })
}
</script>

<template>
  <div class="psp-pop">
    <div class="tb-pop-row">
      <label>段前</label>
      <input class="tb-pop-input" type="number" step="1" min="0" v-model="beforeText" @change="push" />
      <span class="psp-unit">磅</span>
      <label>段后</label>
      <input class="tb-pop-input" type="number" step="1" min="0" v-model="afterText" @change="push" />
      <span class="psp-unit">磅</span>
    </div>
  </div>
</template>

<style>
.psp-pop {
  width: 236px;
}

.psp-pop .tb-pop-row > label {
  width: 26px;
}

.psp-unit {
  color: var(--muted);
  flex-shrink: 0;
}
</style>
