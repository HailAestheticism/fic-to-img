<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useAppStore } from './stores/app'
import { useDocStore } from './stores/doc'
import { useLibraryStore } from './stores/library'
import { api } from './api'
import { showToast } from './composables/toast'
import LibraryView from './views/LibraryView.vue'
import WorkbenchView from './views/WorkbenchView.vue'
import ExportView from './views/ExportView.vue'
import SettingsView from './views/SettingsView.vue'
import PresetLibraryView from './views/PresetLibraryView.vue'
import MobilePanel from './components/workbench/MobilePanel.vue'
import Toast from './components/common/Toast.vue'

const app = useAppStore()
const doc = useDocStore()
const lib = useLibraryStore()

let off: (() => void) | null = null
let offAck: (() => void) | null = null
let offMenu: (() => void) | null = null

onMounted(() => {
  off = api.onMobileChanged((e) => {
    void doc.onRemoteChanged(e)
    if (app.view === 'library') void lib.refresh()
  })
  offAck = api.onMobileInboxAcked((e) => {
    if (e.count > 0) showToast(`手机已收取 ${e.count} 篇文档`)
  })
  offMenu = api.onMenuAction((action) => {
    if (action === 'settings') app.view = 'settings'
    else if (action === 'presets') app.toPresets()
    else if (action === 'home') app.toLibrary()
    else if (action === 'mobile') app.openMobilePanel()
  })
})

onBeforeUnmount(() => {
  off?.()
  offAck?.()
  offMenu?.()
})
</script>

<template>
  <LibraryView v-if="app.view === 'library'" />
  <WorkbenchView v-else-if="app.view === 'workbench'" />
  <SettingsView v-else-if="app.view === 'settings'" />
  <PresetLibraryView v-else-if="app.view === 'presets'" />
  <ExportView v-else />
  <MobilePanel v-if="app.mobilePanel" @close="app.mobilePanel = false" />
  <Toast />
</template>
