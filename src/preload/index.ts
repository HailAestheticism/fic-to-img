import { contextBridge, ipcRenderer } from 'electron'
import type { ApiBridge } from '../shared/types'

/** Vue 响应式 Proxy 无法 structured-clone，统一深拷贝为纯 JSON 再过 IPC */
function plain<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
  ipcRenderer.invoke(channel, ...args.map(plain))

const bridge: ApiBridge = {
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch)
  },
  docs: {
    list: () => invoke('docs:list'),
    cards: () => invoke('docs:cards'),
    get: (id) => invoke('docs:get', id),
    create: (payload) => invoke('docs:create', payload),
    save: (id, payload) => invoke('docs:save', id, payload),
    copy: (id) => invoke('docs:copy', id),
    remove: (id) => invoke('docs:remove', id),
    updateMeta: (id, patch) => invoke('docs:updateMeta', id, patch),
    search: (query) => invoke('docs:search', query),
    importFromPaths: (paths) => invoke('docs:importFromPaths', paths)
  },
  folders: {
    list: () => invoke('folders:list'),
    create: (path) => invoke('folders:create', path),
    remove: (path) => invoke('folders:remove', path)
  },
  assets: {
    import: (docId, paths) => invoke('assets:import', docId, paths),
    importPreset: (paths) => invoke('assets:importPreset', paths),
    saveData: (docId, name, base64) => invoke('assets:saveData', docId, name, base64)
  },
  snapshots: {
    list: (docId) => invoke('snapshots:list', docId),
    create: (docId, payload) => invoke('snapshots:create', docId, payload),
    get: (docId, name) => invoke('snapshots:get', docId, name),
    remove: (docId, name) => invoke('snapshots:remove', docId, name)
  },
  dialog: {
    openFile: (options) => invoke('dialog:openFile', options),
    openDirectory: () => invoke('dialog:openDirectory'),
    saveFile: (options) => invoke('dialog:saveFile', options)
  },
  presets: {
    list: () => invoke('presets:list'),
    save: (preset) => invoke('presets:save', preset),
    remove: (id) => invoke('presets:remove', id),
    importFromPaths: (paths) => invoke('presets:importFromPaths', paths),
    exportToPath: (path, ids) => invoke('presets:exportToPath', path, ids)
  },
  export: {
    run: (options, bundle) => invoke('export:run', options, bundle),
    checks: (options, bundle) => invoke('export:checks', options, bundle),
    listPages: (options, bundle) => invoke('export:pages', options, bundle)
  },
  fonts: {
    list: () => invoke('fonts:list')
  },
  mobile: {
    status: () => invoke('mobile:status'),
    setEnabled: (enabled) => invoke('mobile:setEnabled', enabled),
    setPort: (port) => invoke('mobile:setPort', port),
    rotateToken: () => invoke('mobile:rotateToken'),
    syncToPhone: (docIds) => invoke('mobile:syncToPhone', docIds)
  },
  onExportProgress: (cb) => {
    const listener = (_e: unknown, p: unknown) => cb(p as Parameters<typeof cb>[0])
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  onMobileChanged: (cb) => {
    const listener = (_e: unknown, p: unknown) => cb(p as Parameters<typeof cb>[0])
    ipcRenderer.on('mobile:changed', listener)
    return () => ipcRenderer.removeListener('mobile:changed', listener)
  },
  onMobileInboxAcked: (cb) => {
    const listener = (_e: unknown, p: unknown) => cb(p as Parameters<typeof cb>[0])
    ipcRenderer.on('mobile:inbox-acked', listener)
    return () => ipcRenderer.removeListener('mobile:inbox-acked', listener)
  },
  onMenuAction: (cb) => {
    const listener = (_e: unknown, action: unknown) => cb(action as Parameters<typeof cb>[0])
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
  app: {
    info: () => invoke('app:info')
  }
} as ApiBridge

contextBridge.exposeInMainWorld('api', bridge)
