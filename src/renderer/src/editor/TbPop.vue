<script setup lang="ts">
/** 工具栏通用浮窗：点击按钮在下方弹出面板，点外部/Esc 关闭；同一时间只允许一个浮窗打开 */
import { nextTick, onBeforeUnmount, ref } from 'vue'
import { usePopoverSlot } from '../composables/popoverSlot'

defineProps<{ label: string; title?: string; active?: boolean; width?: number; indicator?: string | null }>()

const { isOpen: open, open: show, close } = usePopoverSlot()
const btnEl = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const pos = ref<{ top: number; left: number }>({ top: 0, left: 0 })

async function toggle(): Promise<void> {
  if (open.value) {
    close()
    return
  }
  show()
  const r = btnEl.value?.getBoundingClientRect()
  if (r) pos.value = { top: r.bottom + 4, left: r.left }
  await nextTick()
  const pop = popEl.value?.getBoundingClientRect()
  if (!pop || !r) return
  let left = pos.value.left
  if (pop.right > window.innerWidth - 8) left = Math.max(8, r.right - pop.width)
  let top = pos.value.top
  if (pop.bottom > window.innerHeight - 8) top = Math.max(8, r.top - pop.height - 4)
  pos.value = { top, left }
}

function onDocClick(e: MouseEvent): void {
  if (!open.value) return
  const t = e.target as HTMLElement
  if (t.closest('.tb-pop') || t.closest('.tb-pop-btn')) return
  close()
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) close()
}

document.addEventListener('click', onDocClick, true)
document.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKeydown)
})

defineExpose({ close })
</script>

<template>
  <button
    ref="btnEl"
    class="tb-btn tb-pop-btn"
    :class="{ active: open || active }"
    :title="title || label"
    @click="toggle"
  >
    <span class="tb-pop-label">{{ label }}</span>
    <i v-if="indicator !== undefined && indicator !== null" class="tb-indicator" :style="{ background: indicator || 'transparent' }" />
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="popEl"
      class="tb-pop"
      :style="{ top: pos.top + 'px', left: pos.left + 'px', width: width ? width + 'px' : undefined }"
    >
      <slot :close="close" />
    </div>
  </Teleport>
</template>

<style>
.tb-pop-btn {
  position: relative;
  flex-direction: column;
  gap: 0;
  line-height: 1.1;
  padding: 2px 6px 4px;
}

.tb-pop-label {
  font-size: 12px;
}

.tb-indicator {
  display: block;
  width: 16px;
  height: 4px;
  border-radius: 2px;
  border: 1px solid rgb(47 42 38 / 15%);
  margin-top: 2px;
}

.tb-pop {
  position: fixed;
  z-index: 130;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 10px;
  font-size: 12px;
  color: var(--ink);
}

.tb-pop-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.tb-pop-row:last-child {
  margin-bottom: 0;
}

.tb-pop-row > label {
  flex-shrink: 0;
  color: var(--ink-soft);
}

.tb-pop-input {
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--panel);
  color: var(--ink);
  font-size: 12px;
  padding: 0 6px;
  min-width: 0;
  flex: 1;
}

.tb-pop-input:focus {
  outline: none;
  border-color: var(--accent);
}

.tb-pop-check {
  width: 14px;
  height: 14px;
  accent-color: var(--accent);
  flex-shrink: 0;
}

.tb-pop-btn.small {
  height: 22px;
  min-width: 0;
  padding: 0 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: 5px;
}
</style>
