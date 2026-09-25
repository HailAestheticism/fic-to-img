<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { usePopoverSlot } from '../../composables/popoverSlot'
import { fontLabel, useSystemFonts } from '../../presets/font-store'

const props = withDefaults(defineProps<{ modelValue: string; placeholder?: string; title?: string }>(), {
  placeholder: '字体',
  title: '选择字体'
})
const emit = defineEmits<{ (e: 'update:modelValue', family: string): void }>()

const { groups, loading } = useSystemFonts()

/** 全局规则：同一时间只允许一个浮窗打开，字体下拉亦参与互斥 */
const open = usePopoverSlot().isOpen
const filter = ref('')
const anchor = ref<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 0 })
const btnEl = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)
const MAX_SHOWN = 200

const options = ref<{ name: string; items: { family: string; label: string }[] }[]>([])

function rebuild(): void {
  const q = filter.value.trim().toLowerCase()
  if (!q) {
    options.value = groups.value.map((g) => ({ name: g.name, items: g.items.slice(0, MAX_SHOWN) }))
    return
  }
  options.value = groups.value
    .map((g) => ({
      name: g.name,
      items: g.items.filter((f) => f.family.toLowerCase().includes(q) || f.label.toLowerCase().includes(q))
    }))
    .filter((g) => g.items.length)
}

watch([groups, filter], rebuild, { immediate: true, deep: true })

async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  filter.value = ''
  const r = btnEl.value?.getBoundingClientRect()
  if (r) {
    const width = Math.max(r.width, 240)
    anchor.value = { top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - width - 8), width }
  }
  await nextTick()
  const pop = popEl.value?.getBoundingClientRect()
  if (pop && pop.bottom > window.innerHeight - 8) {
    anchor.value = { ...anchor.value, top: Math.max(8, window.innerHeight - pop.height - 8) }
  }
  inputEl.value?.focus()
}

function pick(family: string): void {
  emit('update:modelValue', family)
  open.value = false
}

function onDocClick(e: MouseEvent): void {
  if (!open.value) return
  const t = e.target as HTMLElement
  if (t.closest('.font-select-pop') || t.closest('.font-select-btn')) return
  open.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && open.value) open.value = false
}

document.addEventListener('click', onDocClick, true)
document.addEventListener('keydown', onKeydown)
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <button ref="btnEl" class="btn input font-select-btn" :title="title" @click="toggle">
    <span class="fs-current" :style="{ fontFamily: modelValue || undefined }">
      {{ modelValue ? fontLabel(modelValue) : placeholder }}
    </span>
    <span class="fs-caret">▾</span>
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="popEl"
      class="font-select-pop"
      :style="{ top: anchor.top + 'px', left: anchor.left + 'px', width: anchor.width + 'px' }"
    >
      <input
        ref="inputEl"
        v-model="filter"
        class="input fs-search"
        placeholder="搜索字体…"
        @keydown.esc="open = false"
      />
      <div class="fs-list">
        <p v-if="loading" class="fs-hint">正在读取本机字体…</p>
        <template v-for="g in options" :key="g.name">
          <p class="fs-group">{{ g.name }}</p>
          <button
            v-for="f in g.items"
            :key="g.name + f.family"
            class="fs-item"
            :class="{ active: f.family === modelValue }"
            :style="{ fontFamily: f.family }"
            @click="pick(f.family)"
          >
            {{ f.label }}
            <span class="fs-sample">永 Aa</span>
          </button>
        </template>
        <p v-if="!options.length" class="fs-hint">没有匹配的字体</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.font-select-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  text-align: left;
}

.fs-current {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fs-caret {
  color: var(--muted);
  font-size: 10px;
}

.font-select-pop {
  position: fixed;
  z-index: 120;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fs-search {
  width: 100%;
}

.fs-list {
  max-height: 320px;
  overflow-y: auto;
}

.fs-group {
  font-size: 11px;
  color: var(--muted);
  padding: 6px 8px 2px;
  position: sticky;
  top: 0;
  background: var(--panel);
}

.fs-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  color: var(--ink);
  font-size: 13px;
  padding: 6px 8px;
  border-radius: 6px;
  text-align: left;
}

.fs-item:hover {
  background: var(--panel-soft);
}

.fs-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.fs-sample {
  font-size: 11px;
  color: var(--muted);
}
</style>
