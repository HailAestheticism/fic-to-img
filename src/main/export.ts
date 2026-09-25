import { BrowserWindow, nativeImage, app, ipcMain } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import archiver from 'archiver'
import { formatBytes } from '../shared/types'
import type {
  DocBundle,
  ExportCheckResult,
  ExportOptions,
  ExportPageInfo,
  ExportProgress,
  ExportResult
} from '../shared/types'

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名'
}

function rendererExportUrl(): string {
  const base = process.env['ELECTRON_RENDERER_URL']
  if (base) return `${base}?export=1`
  return `${pathToFileURL(join(__dirname, '../renderer/index.html')).toString()}?export=1`
}

const SURFACE_DIAG_EXPR = `JSON.stringify({href: location.href, ready: !!window.__exportReady, api: typeof window.__exportApi, appHtmlLen: (document.getElementById('app')?.innerHTML ?? '').length, lastError: window.__exportLastError ?? null})`

async function createExportWindow(options: ExportOptions, bundle: DocBundle): Promise<BrowserWindow> {
  // 视口尺寸由 CDP 设备度量覆盖决定，窗口本身只需存在且不超过屏幕
  const win = new BrowserWindow({
    show: false,
    x: 0,
    y: 0,
    width: 1024,
    height: 768,
    useContentSize: true,
    frame: false,
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  if (!app.isPackaged) {
    win.webContents.on('console-message', (...args: unknown[]) => {
      const first = args[0] as { level?: unknown; message?: string } | undefined
      if (first && typeof first === 'object' && typeof first.message === 'string') {
        console.log('[export-window]', first.level ?? '', first.message)
      } else {
        console.log('[export-window]', args[1], args[2])
      }
    })
  }
  await win.loadURL(rendererExportUrl())

  const code = (expr: string): Promise<unknown> => win.webContents.executeJavaScript(expr)
  // 渲染面：onMounted 末尾置 __exportReady 并注册 __exportApi（init 为其方法）
  let ready = false
  for (let i = 0; i < 100; i++) {
    ready = Boolean(
      await code('window.__exportReady === true && typeof window.__exportApi === "object"').catch(
        () => false
      )
    )
    if (ready) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!ready) {
    const diag = await code(SURFACE_DIAG_EXPR).catch(() => 'diag-failed')
    console.log('[export] surface not ready, diag:', diag)
    throw new Error('导出渲染面初始化超时')
  }
  const payload = JSON.stringify({ options, bundle })
  const initErr = await code(`window.__exportApi.init(${payload})`).catch((e: unknown) => String(e))
  if (typeof initErr === 'string') {
    console.log('[export] init failed:', initErr, await code(SURFACE_DIAG_EXPR).catch(() => ''))
    throw new Error(`导出渲染面初始化失败：${initErr}`)
  }
  win.webContents.debugger.attach('1.3')
  return win
}

/** 设定导出视口的 CSS 尺寸与倍率（与窗口大小、系统 DPI 无关） */
async function setViewport(
  win: BrowserWindow,
  cssW: number,
  cssH: number,
  scale: number
): Promise<void> {
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: Math.ceil(cssW),
    height: Math.ceil(cssH),
    deviceScaleFactor: scale,
    mobile: false
  })
}

/** 截取当前视口 */
async function captureViewport(win: BrowserWindow, ext: 'png' | 'jpg'): Promise<Buffer> {
  await win.webContents.executeJavaScript(
    'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
  )
  const shot = await win.webContents.debugger.sendCommand(
    'Page.captureScreenshot',
    ext === 'jpg'
      ? { format: 'jpeg', quality: 92, captureBeyondViewport: false }
      : { format: 'png', captureBeyondViewport: false }
  )
  return Buffer.from(shot.data as string, 'base64')
}

async function captureView(
  win: BrowserWindow,
  cssW: number,
  cssH: number,
  scale: number,
  ext: 'png' | 'jpg'
): Promise<Buffer> {
  await setViewport(win, cssW, cssH, scale)
  return captureViewport(win, ext)
}

async function exec<T>(win: BrowserWindow, expr: string): Promise<T> {
  return (await win.webContents.executeJavaScript(expr)) as T
}

interface BeginInfo {
  pages: number
  total: number
  chapterIds: string[]
  chapterTitles: string[]
}

function sendProgress(sender: Electron.WebContents, p: ExportProgress): void {
  if (!sender.isDestroyed()) sender.send('export:progress', p)
}

function zipFiles(zipPath: string, entries: { name: string; file: string }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', () => resolve())
    archive.on('error', reject)
    archive.pipe(output)
    for (const e of entries) archive.file(e.file, { name: e.name })
    void archive.finalize()
  })
}

interface PageLabel {
  chapterId: string
  chapterTitle: string
  pageIndexInChapter: number
  widthCss: number
  heightCss: number
}

/** 压缩档目标：社媒单图 ≤2MB */
const COMPRESS_TARGET_BYTES = 2 * 1024 * 1024

/** 压缩档：成品图超过 2MB 时逐级降 JPEG 质量直到达标（PNG 无法可靠压进 2MB，转 JPEG） */
function compressToTarget(buf: Buffer, ext: 'png' | 'jpg'): { buf: Buffer; ext: 'png' | 'jpg' } {
  if (buf.length <= COMPRESS_TARGET_BYTES) return { buf, ext }
  const img = nativeImage.createFromBuffer(buf)
  for (let q = 92; q >= 40; q -= 8) {
    const out = Buffer.from(img.toJPEG(q))
    if (out.length <= COMPRESS_TARGET_BYTES) return { buf: out, ext: 'jpg' }
  }
  return { buf: Buffer.from(img.toJPEG(40)), ext: 'jpg' }
}

/** 章节重名时按章节出现顺序加序号前缀，避免磁盘与压缩包内文件名冲突 */
function buildPageNamer(begin: {
  chapterIds: string[]
  chapterTitles: string[]
}): (label: PageLabel) => string {
  const titleCounts = new Map<string, number>()
  for (const t of begin.chapterTitles) titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1)
  const seen = new Map<string, number>()
  const prefix = new Map<string, string>()
  begin.chapterIds.forEach((id, i) => {
    const title = begin.chapterTitles[i]
    if ((titleCounts.get(title) ?? 0) > 1) {
      const occ = (seen.get(title) ?? 0) + 1
      seen.set(title, occ)
      prefix.set(id, `${occ}-`)
    } else prefix.set(id, '')
  })
  return (label) =>
    `${prefix.get(label.chapterId) ?? ''}${safeName(label.chapterTitle)}-第${label.pageIndexInChapter + 1}页`
}

async function exportPages(
  win: BrowserWindow,
  options: ExportOptions,
  sender: Electron.WebContents,
  ext: 'png' | 'jpg'
): Promise<{ files: string[]; labels: PageLabel[]; namer: (l: PageLabel) => string }> {
  const begin = await exec<BeginInfo>(win, 'window.__exportApi.begin()')
  const total = begin.pages
  const namer = buildPageNamer(begin)
  const files: string[] = []
  const labels: PageLabel[] = []
  for (let i = 0; i < total; i++) {
    const label = await exec<PageLabel>(win, `window.__exportApi.renderPage(${i})`)
    labels.push(label)
    let buf = await captureView(win, label.widthCss, label.heightCss, options.scale, ext)
    let fileExt = ext
    if (options.quality === 'compressed') {
      const r = compressToTarget(buf, ext)
      buf = r.buf
      fileExt = r.ext
    }
    const name = `${safeName(options.title)}-${namer(label)}.${fileExt}`
    const file = join(options.outputDir, name)
    await writeFile(file, buf)
    files.push(file)
    sendProgress(sender, { phase: 'render', done: i + 1, total, message: `已导出 ${name}` })
  }
  return { files, labels, namer }
}

/** 整幅成图要画的段落：全文 / 单章 / 所选页首尾相接（合成大图） */
interface LongSelection {
  kind: 'doc' | 'chapter' | 'plans'
  chapterId?: string | null
  title?: string | null
}

/** 长图/合成大图：分块截图后由主进程拼成整幅位图 */
async function exportOneLong(
  win: BrowserWindow,
  options: ExportOptions,
  sender: Electron.WebContents,
  sel: LongSelection,
  done: number,
  total: number
): Promise<string[]> {
  const S = options.scale
  const dims = await exec<{ widthCss: number; heightCss: number }>(
    win,
    `window.__exportApi.prepareLongImage(${JSON.stringify(sel)})`
  )
  if (!dims) return []
  const W = Math.round(Math.ceil(dims.widthCss) * S)
  const totalH = Math.round(Math.ceil(dims.heightCss) * S)
  if (W * totalH * 4 > 1_500_000_000) {
    throw new Error('长图尺寸超出内存上限，请降低导出倍率或改为按章导出')
  }
  const chunkCssH = Math.max(1, Math.min(dims.heightCss, Math.floor(6000 / S)))
  const full = Buffer.alloc(W * totalH * 4)
  // 画布横向的无限长图沿水平轴生长（古籍右起竖排），需按列分块截图拼接
  const horizontal = dims.widthCss > dims.heightCss
  if (horizontal) {
    const chunkCssW = Math.max(1, Math.min(dims.widthCss, Math.floor(6000 / S)))
    for (let xCss = 0; xCss < dims.widthCss; xCss += chunkCssW) {
      const wCss = Math.min(chunkCssW, dims.widthCss - xCss)
      await setViewport(win, wCss, dims.heightCss, S)
      await exec(win, `window.__exportApi.scrollLong(0, ${xCss})`)
      const chunk = nativeImage.createFromBuffer(await captureViewport(win, 'png'))
      const { width: cw, height: ch } = chunk.getSize()
      const bmp = Buffer.from(chunk.toBitmap())
      const xPhys = Math.round(xCss * S)
      const cols = Math.max(0, Math.min(cw, W - xPhys))
      const rows = Math.max(0, Math.min(ch, totalH))
      for (let r = 0; r < rows; r++) {
        bmp.copy(full, (r * W + xPhys) * 4, r * cw * 4, r * cw * 4 + cols * 4)
      }
      sendProgress(sender, {
        phase: 'render',
        done,
        total,
        message: `长图拼接中 ${Math.round((xCss / Math.max(1, dims.widthCss)) * 100)}%`
      })
    }
  } else
  for (let yCss = 0; yCss < dims.heightCss; yCss += chunkCssH) {
    const hCss = Math.min(chunkCssH, dims.heightCss - yCss)
    await setViewport(win, dims.widthCss, hCss, S)
    await exec(win, `window.__exportApi.scrollLong(${yCss})`)
    const chunk = nativeImage.createFromBuffer(await captureViewport(win, 'png'))
    const { width: cw, height: ch } = chunk.getSize()
    const bmp = Buffer.from(chunk.toBitmap())
    const yPhys = Math.round(yCss * S)
    const rows = Math.max(0, Math.min(ch, totalH - yPhys))
    const copyW = Math.min(cw, W)
    for (let r = 0; r < rows; r++) {
      bmp.copy(full, (yPhys + r) * W * 4, r * cw * 4, r * cw * 4 + copyW * 4)
    }
    sendProgress(sender, {
      phase: 'render',
      done,
      total,
      message: `长图拼接中 ${Math.round((yCss / Math.max(1, dims.heightCss)) * 100)}%`
    })
  }
  const finalImg = nativeImage.createFromBitmap(full, { width: W, height: totalH })
  // 全文长图 JPEG / 合成大 JPEG：同一条长图，只是编码换成 JPEG
  const asJpeg = options.format === 'jpeg'
  let imgBuf = asJpeg ? Buffer.from(finalImg.toJPEG(92)) : Buffer.from(finalImg.toPNG())
  let ext: 'png' | 'jpg' = asJpeg ? 'jpg' : 'png'
  if (options.quality === 'compressed') {
    const r = compressToTarget(imgBuf, ext)
    imgBuf = r.buf
    ext = r.ext
  }
  const stem =
    sel.kind === 'chapter'
      ? `${safeName(options.title)}-长图-${safeName(sel.title ?? '')}`
      : sel.kind === 'plans'
        ? `${safeName(options.title)}-合成大图`
        : `${safeName(options.title)}-长图`
  const file = join(options.outputDir, `${stem}.${ext}`)
  await writeFile(file, imgBuf)
  return [file]
}

async function exportLongImages(
  win: BrowserWindow,
  options: ExportOptions,
  sender: Electron.WebContents
): Promise<string[]> {
  if (options.longScope === 'perChapter') {
    const begin = await exec<BeginInfo>(win, 'window.__exportApi.begin()')
    const files: string[] = []
    for (let i = 0; i < begin.chapterIds.length; i++) {
      files.push(
        ...(await exportOneLong(
          win,
          options,
          sender,
          { kind: 'chapter', chapterId: begin.chapterIds[i], title: begin.chapterTitles[i] },
          i + 1,
          begin.chapterIds.length
        ))
      )
    }
    return files
  }
  // 全文 = 整篇流式一图；部分选择 = 所选内容首尾相接一图
  const sel: LongSelection = options.range === 'all' ? { kind: 'doc' } : { kind: 'plans' }
  return exportOneLong(win, options, sender, sel, 0, 1)
}

export function registerExportIpc(): void {
  ipcMain.handle(
    'export:checks',
    async (_e, options: ExportOptions, bundle: DocBundle): Promise<ExportCheckResult> => {
      let win: BrowserWindow | null = null
      try {
        win = await createExportWindow(options, bundle)
        return await exec<ExportCheckResult>(win, 'window.__exportApi.runChecks()')
      } finally {
        win?.destroy()
      }
    }
  )

  ipcMain.handle(
    'export:pages',
    async (_e, options: ExportOptions, bundle: DocBundle): Promise<ExportPageInfo[]> => {
      let win: BrowserWindow | null = null
      try {
        win = await createExportWindow(options, bundle)
        return await exec<ExportPageInfo[]>(win, 'window.__exportApi.listPages()')
      } finally {
        win?.destroy()
      }
    }
  )

  ipcMain.handle(
    'export:run',
    async (e, options: ExportOptions, bundle: DocBundle): Promise<ExportResult> => {
      const sender = e.sender
      let win: BrowserWindow | null = null
      try {
        await mkdir(options.outputDir, { recursive: true })
        sendProgress(sender, { phase: 'prepare', done: 0, total: 0, message: '准备导出渲染面…' })
        win = await createExportWindow(options, bundle)
        const files: string[] = []
        let zipFile: string | undefined

        // 无限长图没有「页」的概念：按章导出＝每章一张长图；JPEG 与长图同一条管线
        const infinite = bundle.layout.pageSetup.infiniteHeight === true
        const asLong =
          options.format === 'long' ||
          options.format === 'jpeg' ||
          (infinite && options.format === 'chapterZip')

        if (asLong) {
          const longOptions: ExportOptions =
            options.format === 'chapterZip'
              ? { ...options, format: 'long', longScope: 'perChapter' }
              : options
          const longFiles = await exportLongImages(win, longOptions, sender)
          files.push(...longFiles)
          // 无限画布的「分章节 PNG」= 每章一张长图，同样打包（散图请选「合成大 PNG」）
          if (options.format === 'chapterZip') {
            sendProgress(sender, { phase: 'zip', done: 0, total: 1, message: '正在打包 ZIP…' })
            const zipPath = join(options.outputDir, `${safeName(options.title)}-分章节.zip`)
            await zipFiles(
              zipPath,
              longFiles.map((file) => ({ file, name: basename(file) }))
            )
            zipFile = zipPath
          }
        } else if (options.format === 'pages' || options.format === 'chapterZip') {
          const { files: pageFiles, labels } = await exportPages(win, options, sender, 'png')
          files.push(...pageFiles)
          // 分章节 / 分页 PNG 恒打包，与选中数量无关（只要一张图请选「合成大 PNG」）
          // 压缩档可能把 png 转成 jpg，打包时用磁盘上的真实文件名
          sendProgress(sender, { phase: 'zip', done: 0, total: 1, message: '正在打包 ZIP…' })
          const byChapter = options.format === 'chapterZip'
          const zipPath = join(
            options.outputDir,
            `${safeName(options.title)}-${byChapter ? '分章节' : '分页'}.zip`
          )
          const entries = byChapter
            ? pageFiles.map((file, i) => ({
                file,
                name: join(safeName(labels[i].chapterTitle), basename(file)).replace(/\\/g, '/')
              }))
            : pageFiles.map((file) => ({ file, name: basename(file) }))
          await zipFiles(zipPath, entries)
          zipFile = zipPath
        }

        const all = zipFile ? [...files, zipFile] : files
        let totalBytes = 0
        for (const f of all) totalBytes += (await stat(f)).size

        sendProgress(sender, {
          phase: 'done',
          done: 1,
          total: 1,
          message: `完成：共 ${files.length} 个文件${zipFile ? ' + 1 个压缩包' : ''}，${formatBytes(totalBytes)}`
        })
        return { outputDir: options.outputDir, files, zipFile, totalBytes }
      } catch (err) {
        sendProgress(sender, {
          phase: 'error',
          done: 0,
          total: 0,
          message: err instanceof Error ? err.message : String(err)
        })
        throw err
      } finally {
        win?.destroy()
      }
    }
  )
}
