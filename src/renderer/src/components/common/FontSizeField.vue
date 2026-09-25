<script setup lang="ts">
/** 字号输入：中文字号名 ↔ 磅值双向联动（与文本编辑界面一致） */
import { ref, watch } from 'vue'
import { cnNameToPt, ptToCnName, roundHalf } from '../../editor/format-units'

const props = defineProps<{ modelValue: number; min?: number; max?: number }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>()

const cn = ref(ptToCnName(props.modelValue) || '')
const pt = ref<number>(props.modelValue)

watch(
  () => props.modelValue,
  (v) => {
    pt.value = v
    cn.value = ptToCnName(v) || ''
  }
)

function clamp(v: number): number {
  const min = props.min ?? 5
  const max = props.max ?? 96
  return Math.max(min, Math.min(max, v))
}

function onPt(): void {
  const v = Number(pt.value)
  if (!isFinite(v) || v <= 0) {
    pt.value = props.modelValue
    return
  }
  const next = clamp(roundHalf(v))
  pt.value = next
  cn.value = ptToCnName(next) || ''
  if (next !== props.modelValue) emit('update:modelValue', next)
}

function onCn(): void {
  const hit = cnNameToPt(cn.value)
  if (hit === null) {
    cn.value = ptToCnName(props.modelValue) || ''
    return
  }
  pt.value = hit
  emit('update:modelValue', hit)
}
</script>

<template>
  <span class="fsf">
    <input
      v-model="cn"
      class="input fsf-cn"
      placeholder="中文字号"
      title="中文字号（初号…八号）"
      @change="onCn"
    />
    <input v-model.number="pt" class="input fsf-pt" type="number" step="0.5" title="磅值" @change="onPt" />
  </span>
</template>

<style scoped>
.fsf {
  display: flex;
  gap: 4px;
  min-width: 0;
}

.fsf-cn {
  width: 64px;
  min-width: 0;
  padding: 3px 4px;
  font-size: 11px;
}

.fsf-pt {
  width: 44px;
  min-width: 0;
  padding: 3px 4px;
  font-size: 11px;
}
</style>
