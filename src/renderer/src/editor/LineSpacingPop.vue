<script setup lang="ts">
/**
 * 行距浮窗：倍数 / 最小值 / 固定值 三选一。
 * 倍数存 CSS 无单位值；固定值存 npt；最小值存 max(npt, 1.15em)。
 */
import { ref } from 'vue'

const props = defineProps<{ modelValue: string | null }>()
const emit = defineEmits<{ (e: 'apply', value: string | null): void }>()

type Mode = 'multiple' | 'min' | 'fixed'
const mode = ref<Mode>('multiple')

const raw = (props.modelValue || '').trim()
const multText = ref('')
const minText = ref('')
const fixedText = ref('')

const maxMatch = /^max\(\s*([\d.]+)pt/i.exec(raw)
if (maxMatch) {
  mode.value = 'min'
  minText.value = String(Math.round(parseFloat(maxMatch[1])))
} else if (/pt$/i.test(raw)) {
  mode.value = 'fixed'
  fixedText.value = String(Math.round(parseFloat(raw)))
} else if (raw && isFinite(parseFloat(raw))) {
  mode.value = 'multiple'
  multText.value = String(parseFloat(raw))
}

function apply(): void {
  const raw = mode.value === 'multiple' ? multText.value : mode.value === 'fixed' ? fixedText.value : minText.value
  if (!String(raw).trim()) return // 空值不下发，等待用户输入
  if (mode.value === 'multiple') {
    const n = Math.max(0.5, Math.min(10, Math.round(Number(multText.value) * 2) / 2))
    multText.value = String(n)
    emit('apply', String(n))
  } else if (mode.value === 'fixed') {
    const n = Math.max(1, Math.min(220, Math.round(Number(fixedText.value)) || 1))
    fixedText.value = String(n)
    emit('apply', `${n}pt`)
  } else {
    const n = Math.max(1, Math.min(220, Math.round(Number(minText.value)) || 1))
    minText.value = String(n)
    emit('apply', `max(${n}pt, 1.15em)`)
  }
}

function select(m: Mode): void {
  mode.value = m
}

function change(m: Mode, e: Event): void {
  const el = e.target as HTMLInputElement
  // 勾选框只许切换、不许取消（必须且仅选 1 个）
  if (el.type === 'checkbox' && !el.checked) el.checked = true
  mode.value = m
  if (el.type === 'checkbox') {
    apply()
    return
  }
  const v = el.value
  if (m === 'multiple') multText.value = v
  else if (m === 'min') minText.value = v
  else fixedText.value = v
  apply()
}
</script>

<template>
  <div class="lsp-pop">
    <div class="tb-pop-row">
      <input class="tb-pop-check" type="checkbox" :checked="mode === 'multiple'" @change="change('multiple', $event)" />
      <label>倍数</label>
      <input class="tb-pop-input" type="number" step="0.5" min="0.5" :value="multText" @change="change('multiple', $event)" />
      <span class="lsp-unit">倍</span>
    </div>
    <div class="tb-pop-row">
      <input class="tb-pop-check" type="checkbox" :checked="mode === 'min'" @change="change('min', $event)" />
      <label>最小值</label>
      <input class="tb-pop-input" type="number" step="1" min="1" :value="minText" @change="change('min', $event)" />
      <span class="lsp-unit">磅</span>
    </div>
    <div class="tb-pop-row">
      <input class="tb-pop-check" type="checkbox" :checked="mode === 'fixed'" @change="change('fixed', $event)" />
      <label>固定值</label>
      <input class="tb-pop-input" type="number" step="1" min="1" :value="fixedText" @change="change('fixed', $event)" />
      <span class="lsp-unit">磅</span>
    </div>
    <p class="lsp-hint">三选一：勾选其一即生效</p>
  </div>
</template>

<style>
.lsp-pop {
  width: 216px;
}

.lsp-pop .tb-pop-row > label {
  width: 40px;
}

.lsp-unit {
  color: var(--muted);
  flex-shrink: 0;
}

.lsp-hint {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: 11px;
}
</style>
