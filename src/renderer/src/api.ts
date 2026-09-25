import type { ApiBridge } from '@shared/types'

/**
 * window.api 的渲染层包装。
 * Vue 响应式 Proxy 在跨 contextBridge 边界时无法拷贝（"An object could not be cloned"），
 * 所以必须在调用前把所有出参深拷贝为纯 JSON。
 */
function plain<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

const raw = window.api

export const api: ApiBridge = {
  settings: {
    get: () => raw.settings.get(),
    set: (patch) => raw.settings.set(plain(patch))
  },
  docs: {
    list: () => raw.docs.list(),
    cards: () => raw.docs.cards(),
    get: (id) => raw.docs.get(id),
    create: (payload) => raw.docs.create(plain(payload)),
    save: (id, payload) => raw.docs.save(id, plain(payload)),
    copy: (id) => raw.docs.copy(id),
    remove: (id) => raw.docs.remove(id),
    updateMeta: (id, patch) => raw.docs.updateMeta(id, plain(patch)),
    search: (query) => raw.docs.search(query),
    importFromPaths: (paths) => raw.docs.importFromPaths(paths)
  },
  folders: {
    list: () => raw.folders.list(),
    create: (path) => raw.folders.create(path),
    remove: (path) => raw.folders.remove(path)
  },
  assets: {
    import: (docId, paths) => raw.assets.import(docId, paths),
    importPreset: (paths) => raw.assets.importPreset(paths),
    saveData: (docId, name, base64) => raw.assets.saveData(docId, name, base64)
  },
  snapshots: {
    list: (docId) => raw.snapshots.list(docId),
    create: (docId, payload) => raw.snapshots.create(docId, plain(payload)),
    get: (docId, name) => raw.snapshots.get(docId, name),
    remove: (docId, name) => raw.snapshots.remove(docId, name)
  },
  dialog: {
    openFile: (options) => raw.dialog.openFile(plain(options)),
    openDirectory: () => raw.dialog.openDirectory(),
    saveFile: (options) => raw.dialog.saveFile(plain(options))
  },
  presets: {
    list: () => raw.presets.list(),
    save: (preset) => raw.presets.save(plain(preset)),
    remove: (id) => raw.presets.remove(id),
    importFromPaths: (paths) => raw.presets.importFromPaths(paths),
    exportToPath: (path, ids) => raw.presets.exportToPath(path, plain(ids))
  },
  export: {
    run: (options, bundle) => raw.export.run(plain(options), plain(bundle)),
    checks: (options, bundle) => raw.export.checks(plain(options), plain(bundle)),
    listPages: (options, bundle) => raw.export.listPages(plain(options), plain(bundle))
  },
  fonts: {
    list: () => raw.fonts.list()
  },
  mobile: {
    status: () => raw.mobile.status(),
    setEnabled: (enabled) => raw.mobile.setEnabled(enabled),
    setPort: (port) => raw.mobile.setPort(port),
    rotateToken: () => raw.mobile.rotateToken(),
    syncToPhone: (docIds) => raw.mobile.syncToPhone(plain(docIds))
  },
  onExportProgress: (cb) => raw.onExportProgress(cb),
  onMobileChanged: (cb) => raw.onMobileChanged(cb),
  onMobileInboxAcked: (cb) => raw.onMobileInboxAcked(cb),
  onMenuAction: (cb) => raw.onMenuAction(cb),
  app: {
    info: () => raw.app.info()
  }
}
