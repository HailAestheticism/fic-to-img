import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { join } from 'node:path'
import { registerResourceProtocol } from './protocol'
import { registerStorageIpc } from './storage'
import { registerExportIpc } from './export'
import { registerFontsIpc } from './fonts'
import { initMobile, registerMobileIpc } from './mobile'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'appres',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    title: '文转条图',
    backgroundColor: '#f5f3ef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged) {
    win.webContents.on('console-message', (...args: unknown[]) => {
      // Electron 各版本签名不同：新版为事件对象，旧版为 (event, level, message)
      const first = args[0] as { level?: unknown; message?: string } | undefined
      if (first && typeof first === 'object' && typeof first.message === 'string') {
        console.log(`[renderer]`, first.level ?? '', first.message)
      } else {
        console.log('[renderer]', args[1], args[2])
      }
    })
  }
  win.webContents.once('did-finish-load', () => {
    console.log('[main] renderer loaded')
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function sendMenuAction(
  action: 'import' | 'mobile' | 'settings' | 'presets' | 'home'
): void {
  const win = BrowserWindow.getAllWindows()[0]
  win?.webContents.send('menu:action', action)
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        { label: '回首页', click: () => sendMenuAction('home') },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '导入',
      submenu: [
        { label: '移动端同步', click: () => sendMenuAction('mobile') },
        { label: '本地文件导入', click: () => sendMenuAction('import') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '设置',
      submenu: [
        { label: '预设库', click: () => sendMenuAction('presets') },
        { label: '设置…', click: () => sendMenuAction('settings') }
      ]
    },
    {
      label: '帮助',
      submenu: [{ role: 'about', label: '关于' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  registerResourceProtocol()
  registerStorageIpc()
  registerFontsIpc()
  registerExportIpc()
  registerMobileIpc()
  void initMobile()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
