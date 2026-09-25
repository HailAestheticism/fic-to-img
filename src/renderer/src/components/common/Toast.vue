<script setup lang="ts">
import { useToasts } from '../../composables/toast'

const toasts = useToasts()
</script>

<template>
  <Teleport to="body">
    <TransitionGroup name="toast" tag="div" class="toast-dock">
      <div v-for="t in toasts" :key="t.id" class="toast-item">{{ t.text }}</div>
    </TransitionGroup>
  </Teleport>
</template>

<style scoped>
.toast-dock {
  position: fixed;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  z-index: 3000;
  pointer-events: none;
}

.toast-item {
  background: rgba(32, 38, 34, 0.92);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  padding: 9px 18px;
  border-radius: 999px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
  max-width: 70vw;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
