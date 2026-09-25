<script setup lang="ts">
import { store } from './store'
import ListPage from './views/ListPage.vue'
import EditPage from './views/EditPage.vue'
import SyncPage from './views/SyncPage.vue'
</script>

<template>
  <div class="m-app">
    <ListPage v-if="store.view === 'list'" />
    <EditPage v-else-if="store.view === 'edit'" />
    <SyncPage v-else />
    <Transition name="toast">
      <div v-if="store.toast" class="m-toast">{{ store.toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.m-app {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.m-toast {
  position: fixed;
  left: 50%;
  bottom: calc(64px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  background: rgba(28, 32, 30, 0.92);
  color: #fff;
  font-size: 13px;
  line-height: 1.5;
  padding: 9px 18px;
  border-radius: 999px;
  max-width: 78vw;
  z-index: 2000;
  pointer-events: none;
  white-space: pre-line;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
