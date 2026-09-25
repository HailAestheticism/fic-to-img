<script setup lang="ts">
/**
 * 排版界面图层切换双键（背景层 / 最顶层）：吸顶固定在侧栏最上方，
 * 与混合界面顶部的三键（.ml-switch）同一交互。
 */
import { computed } from 'vue'
import type { LayoutLayer } from '@shared/types'

const props = defineProps<{ modelValue: LayoutLayer }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: LayoutLayer): void }>()

const isBg = computed(() => props.modelValue !== 'top')
</script>

<template>
  <div class="lp-switch">
    <button
      class="lp-big"
      :class="{ on: isBg }"
      title="背景层：位于文字之下，可加元素与背景填充"
      @click="emit('update:modelValue', 'bg')"
    >
      <span class="lp-big-t">背景层</span>
      <span class="lp-big-s">文字之下</span>
    </button>
    <button
      class="lp-big"
      :class="{ on: !isBg }"
      title="最顶层：覆盖在文字之上，只能添加元素"
      @click="emit('update:modelValue', 'top')"
    >
      <span class="lp-big-t">最顶层</span>
      <span class="lp-big-s">覆盖文字</span>
    </button>
  </div>
</template>

<style scoped>
/* 吸顶：滚动侧栏时双键始终停在最上方（同混合界面 .ml-switch） */
.lp-switch {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  gap: 18px;
  padding: 14px 14px 12px;
  background: var(--panel);
}

.lp-big {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 18px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface, #fff);
  color: var(--ink);
  cursor: pointer;
}

.lp-big:hover {
  border-color: var(--accent);
}

.lp-big.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.lp-big-t {
  font-size: 14px;
  font-weight: 600;
}

.lp-big-s {
  font-size: 11px;
  opacity: 0.75;
}
</style>
