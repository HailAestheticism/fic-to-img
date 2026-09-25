<script setup lang="ts">
/**
 * 侧栏折叠卡片：标题行（标题 + 收起时居右的摘要 + 箭头），点标题行开合。
 * 排版/混合界面的「页面设置」「预设」区块使用；open 由父组件控制，便于切界面/切图层时统一重置。
 */
const props = defineProps<{ title: string; hint?: string; open: boolean }>()
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

function toggle(): void {
  emit('update:open', !props.open)
}
</script>

<template>
  <section class="cc">
    <button class="cc-head" type="button" @click="toggle">
      <span class="cc-title">{{ title }}</span>
      <span class="cc-right">
        <span v-if="!open && hint" class="cc-hint">{{ hint }}</span>
        <span class="cc-arrow">{{ open ? '▾' : '▸' }}</span>
      </span>
    </button>
    <div v-show="open" class="cc-body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.cc {
  border-top: 1px solid var(--border);
}

.cc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 12px 14px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink);
  text-align: left;
}

.cc-title {
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.cc-right {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cc-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--muted);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.cc-arrow {
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
}
</style>
