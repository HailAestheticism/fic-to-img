import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WorkbenchMode } from '@shared/types'

export const useAppStore = defineStore('app', () => {
  const view = ref<'library' | 'workbench' | 'export' | 'settings' | 'presets'>('library')
  const mode = ref<WorkbenchMode>('write')
  const currentDocId = ref('')
  /** 预设库是全覆盖界面：返回时回到打开它之前的界面 */
  const presetsFrom = ref<'library' | 'workbench' | 'export' | 'settings'>('library')
  /** 移动端同步面板：任意界面（菜单/设置页）都能唤起，挂全局 */
  const mobilePanel = ref(false)

  function openDoc(id: string): void {
    currentDocId.value = id
    mode.value = 'write'
    view.value = 'workbench'
  }

  function openMobilePanel(): void {
    mobilePanel.value = true
  }

  function toLibrary(): void {
    view.value = 'library'
  }

  function toExport(): void {
    view.value = 'export'
  }

  function toPresets(): void {
    if (view.value === 'presets') return
    presetsFrom.value = view.value
    view.value = 'presets'
  }

  function closePresets(): void {
    view.value = presetsFrom.value
  }

  return {
    view,
    mode,
    currentDocId,
    presetsFrom,
    mobilePanel,
    openDoc,
    toLibrary,
    toExport,
    toPresets,
    closePresets,
    openMobilePanel
  }
})
