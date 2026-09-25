/** 渲染进程与主进程共享的类型定义 */

export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface PMNode {
  type: string
  attrs?: Record<string, any>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

export interface Settings {
  version: 1
  snapshotIntervalMinutes: number
  maxSnapshots: number
  lastOpenedDocId: string | null
  seeded: boolean
  /** 章节侧边栏停靠边，默认 left */
  sidebarSide?: 'left' | 'right'
  /** 页面设置面板「自定义」行保存的画布尺寸，全局共享 */
  customCanvases?: CustomCanvas[]
  /** 新建/导入文档的默认画布：系统预设 key（如 `pcLong`）或自定义尺寸 id；缺省见 paper.ts 的 NEW_DOC_CANVAS_KEY */
  defaultCanvas?: string
  mobile?: MobileSettings
}

/**
 * 用户保存的自定义画布尺寸（持久化在 settings.json）。
 * 存储约定与 PageSetup 一致：widthMm 恒为固定边，heightMm 为长边（无限高度时仅作占位）。
 */
export interface CustomCanvas {
  id: string
  label: string
  widthMm: number
  heightMm: number
  infiniteHeight?: boolean
  margins?: { top: number; right: number; bottom: number; left: number }
}

export interface MobileSettings {
  /** 是否开启局域网手机端同步 */
  enabled: boolean
  port: number
  /** 访问口令，手机端 URL 携带 */
  token: string
}

export interface MobileStatus extends MobileSettings {
  running: boolean
  /** HTTP 访问地址（含口令），用于首次装证书前的引导 */
  urls: string[]
  /** HTTPS 访问地址（含口令），安装 CA 证书后可用，是 PWA 安装/日常同步的推荐入口 */
  httpsUrls: string[]
  /** CA 证书下载地址（HTTP，手机浏览器打开即可下载安装） */
  caUrls: string[]
  error?: string
  /** 手机最近一次联网（拉取收件箱）时间，用于「手机在线」判断 */
  phoneLastSeen?: number
  /** 暂存待手机收取的文档数 */
  pendingCount: number
}

/** 单篇同步载荷：手机端只有 大标题 + 纯文本正文 两个字段 */
export interface MobilePushDoc {
  id: string
  /** 大标题（H0）文本 */
  title: string
  body: string
  /** 发起端文档的「标题联动」开关（PC→手机时决定手机列表显示哪个名字） */
  h0Sync: boolean
  /** 发起端文档名（PC→手机恒带；h0Sync 关时手机列表显示它） */
  pcName?: string
  /** PC 端文档含手机表达不了的排版（提示回传不还原用） */
  rich?: boolean
}

export interface MobilePushResultItem {
  id: string
  ok: boolean
  /** 接收端原先没有该文档，本次新建 */
  created?: boolean
  error?: string
}

/** 一次同步动作在发起端的落点：手机在线与否都进收件箱/直接应用， queued 表示待手机下次收取 */
export interface MobileSyncResult {
  /** 发起方为手机 → PC：已直接写盘；发起方为 PC → 手机：true 表示手机在线（正在轮询） */
  online: boolean
  /** PC → 手机时入队/覆盖的篇数 */
  count: number
}

/** 手机收取完 PC 推送后的回执，PC 端弹提示用 */
export interface MobileInboxAckedEvent {
  count: number
}

export interface MobileChangedEvent {
  docId: string
  updatedAt: number
  /** 来源：手机端保存 / Syncthing 同步 */
  from: 'phone' | 'sync'
}

export interface DocMeta {
  id: string
  title: string
  tags: string[]
  folder: string
  createdAt: number
  updatedAt: number
  /** H0 标题与文档名同步开关；缺省视为 true（默认同步） */
  h0Sync?: boolean
}

/** 排版图层：背景层在文本之下，顶层覆盖文本 */
export type LayoutLayer = 'bg' | 'top'

/** 排版界面当前选中页（图层面板的作用范围与预设套用范围共用） */
export interface ActivePageInfo {
  index: number
  chapterId: string
  chapterTitle: string
  pageIndex: number
}

export interface PageSetup {
  /** 画布宽（纵向画布即短边方向），高度无限时这里是固定边 */
  widthMm: number
  heightMm: number
  /** 长图：长度随文本增长，不启用分页 */
  infiniteHeight?: boolean
  /** 画布横向：渲染时宽高互换，且正文整段竖向排列（= 全局「竖向排列」，图片/表格除外） */
  landscape?: boolean
  marginTopMm: number
  marginRightMm: number
  marginBottomMm: number
  marginLeftMm: number
  header: {
    enabled: boolean
    text: string
    align: AlignKind
    fontSize: number
  }
  footer: {
    enabled: boolean
    text: string
    align: AlignKind
    fontSize: number
    showPageNumber: boolean
    pageNumberFormat: string
    /** 「页码」自身的位置（不传则跟随页脚 align） */
    pageNumberAlign?: AlignKind
    pageNumberFontSize?: number
  }
}

export type AlignKind = 'left' | 'center' | 'right'

/** 背景图填充方式 */
export type ImageFit =
  /** 充满：等比缩放到不留空白，至少两条平行边与画布对应边重合 */
  | 'fill'
  /** 拉伸：四边四角全部重合 */
  | 'stretch'
  /** 平铺：原尺寸像地砖一样铺满 */
  | 'tile'
  /** 错位平铺：相邻列起始高度相差半张图 */
  | 'offset-tile'
  /** 多图：页首/页尾各一张 + 中间区域第三张或纯色/渐变 */
  | 'multi'

/** 对齐锚点：图片与画布哪一侧对齐 */
export type ImageAnchor = 'tl' | 'center' | 'tr'

export interface MultiImageSpec {
  topUrl?: string
  topName?: string
  bottomUrl?: string
  bottomName?: string
  /** 中间剩余区域的填充方式 */
  midKind?: 'image' | 'color' | 'gradient'
  midUrl?: string
  midName?: string
  midFit?: Exclude<ImageFit, 'multi'>
  midAnchor?: ImageAnchor
  midColor?: string
  midGradient?: string
}

export interface BackgroundSpec {
  kind: 'color' | 'gradient' | 'texture' | 'image'
  color?: string
  gradient?: string
  /** 旧数据兼容：纹理平铺已并入「图片·平铺」 */
  textureUrl?: string
  imageUrl?: string
  imageFit?: ImageFit
  imageAnchor?: ImageAnchor
  multi?: MultiImageSpec
  imageOpacity?: number
  /** 导入时的原图片文件名，供文档详情展示 */
  imageName?: string
}

export interface FreeElement {
  id: string
  /** 所属图层，缺省视为背景层 */
  layer?: LayoutLayer
  scope:
    | { type: 'global' }
    | { type: 'chapter'; chapterId: string }
    | { type: 'page'; chapterId: string; pageIndex: number }
  kind: 'sticker' | 'shape' | 'line' | 'text' | 'watermark' | 'draw'
  data: Record<string, any>
  z: number
  locked?: boolean
}

/** 文档级排版令牌：预设系统的样式基础，经 CSS 变量作用于编辑器与分页视图 */
export interface Typography {
  bodyFont: string
  bodySize: number
  bodyLineHeight: string
  bodyColor: string
  headingFont: string
  headingColor: string
  /** 文档标题 H0 字号缩放（相对正文），缺省 2.2 */
  h0Scale?: number
  h1Scale: number
  h2Scale: number
  h3Scale: number
  quoteColor: string
  /** 标题 4~6 级字号缩放（相对正文），缺省用内置递减比例 */
  h4Scale?: number
  h5Scale?: number
  h6Scale?: number
  /** 文档默认段间距（pt），缺省不设置 */
  spaceBeforePt?: number
  spaceAfterPt?: number
  /** 文档默认首行缩进（CSS 长度，如 '2em' / '24pt'），缺省不设置 */
  defaultTextIndent?: string
}

export type PresetKind = 'pageSetup' | 'typography' | 'background' | 'combined'

export interface Preset {
  id: string
  name: string
  kind: PresetKind
  createdAt: number
  updatedAt: number
  data: {
    pageSetup?: PageSetup
    typography?: Typography
    background?: BackgroundSpec | null
  }
}

export interface ChapterMeta {
  id: string
  title: string
  styleOverrides?: Record<string, any>
}

/** 自动分章规则（手动章节符始终生效） */
export interface SplitRules {
  /** 按一级标题（H1）分章 */
  h1: boolean
  /** 按正则匹配标题文本分章，如 ^第[0-9一二三四五六七八九十百千]+章 */
  regex: boolean
  pattern: string
}

export interface DocLayout {
  version: 1
  pageSetup: PageSetup
  typography: Typography
  splitRules: SplitRules
  chapters: Record<string, ChapterMeta>
  backgrounds: {
    global: BackgroundSpec | null
    chapter: Record<string, BackgroundSpec>
    page: Record<string, BackgroundSpec>
  }
  freeElements: FreeElement[]
}

export interface DocBundle {
  meta: DocMeta
  content: PMNode
  layout: DocLayout
}

export interface CreateDocPayload {
  title?: string
  folder?: string
  tags?: string[]
  content?: PMNode
  /** 指定文档 id（UUID）：移动端同步新建文档时保持两端同 id；渲染层不传，仅主进程内部使用 */
  id?: string
}

export interface SaveDocPayload {
  meta?: DocMeta
  content?: PMNode
  layout?: DocLayout
}

export interface SaveResult {
  savedAt: number
  meta: DocMeta
}

export interface SearchHit {
  meta: DocMeta
  snippet?: string
}

/** 文档库卡片信息：正文摘要 + 直观呈现样式所需的排版字段 */
export interface DocCardInfo {
  meta: DocMeta
  /** 正文开头若干自然段（段间以 \n 分隔，已去掉与标题重复的首行；截断与省略号由卡片测量决定） */
  snippet: string
  charCount: number
  bodyFont: string
  bodySize: number
  bodyColor: string
  bodyLineHeight: string
  headingFont: string
  headingColor: string
  /** 文档标题 H0 字号（px，= bodySize × h0Scale）：卡片按它展示文档名 */
  h0Size: number
  /** 各层级标题字号（px，= bodySize × scale） */
  h1Size: number
  h2Size: number
  h3Size: number
  quoteColor: string
  /** 全局背景（卡片预览用；章/页级背景不参与） */
  background: BackgroundSpec | null
  widthMm: number
  heightMm: number
  /** 无限高画布（长图）：高边随文本增长，卡片与详情按「×无限」标注 */
  infiniteHeight: boolean
  landscape: boolean
  marginsMm: { top: number; right: number; bottom: number; left: number }
  /** 派生章节标题，供目录树与思维导图展开 */
  chapters: string[]
}

/** 文档库文件夹（含尚未放入文档的空文件夹） */
export interface DocFolder {
  /** 归一化多级路径，如 小说/第一卷 */
  path: string
  createdAt: number
}

/** 本机已安装字体 */
export interface SystemFont {
  family: string
  /** 中文名（已知字体）或字体原名 */
  label: string
}

export interface ImportedAsset {
  name: string
  relPath: string
  url: string
}

export interface FileDialogOptions {
  title?: string
  filters?: { name: string; extensions: string[] }[]
  multi?: boolean
}

export interface SaveFileDialogOptions {
  title?: string
  defaultName?: string
  filters?: { name: string; extensions: string[] }[]
}

export interface SnapshotInfo {
  name: string
  savedAt: number
  label?: string
  size: number
}

export interface SnapshotData {
  savedAt: number
  label?: string
  content: PMNode
  layout: DocLayout
}

/** history/*.json 的完整文件结构 */
export interface SnapshotFile extends SnapshotData {
  content: PMNode
  layout: DocLayout
}

export interface AppInfo {
  version: string
  electron: string
  dataDir: string
}

export type WorkbenchMode = 'write' | 'layout' | 'mixed' | 'preview'

/**
 * 导出形式（可选项随「导出范围」而变，见 交接文档.md §4）：
 * - `long` 全文时=全文长图 PNG；部分选择时=合成大 PNG（选中内容首尾相接成一张）
 * - `jpeg` 全文长图 JPEG / 合成大 JPEG（同样是整幅长图，只是编码为 JPEG）
 * - `chapterZip` 分章节 PNG（打包）；`pages` 分页 PNG（打包）——恒打包，与选中数量无关
 *
 * 阶段 39 起不再有 PDF 导出形式（`pdf` / `pdfSplit` 与打印管线一并删除）。
 */
export type ExportFormat = 'pages' | 'chapterZip' | 'long' | 'jpeg'

/** 清晰度：原图 = 1x 无损；高清 = 300DPI；压缩 = 单张成品图 ≤2MB（社媒图片大小要求） */
export type ExportQuality = 'original' | 'hd' | 'compressed'

/** 压缩档的模糊阈值：JPEG 每像素低于约 1 字节时文字边缘开始出现可见压缩伪影，2MB ≈ 2×1024×1024 字节 → 约 200 万像素 */
export const COMPRESS_BLUR_PIXEL_LIMIT = 2_000_000

/**
 * 位图成品体积估算：每 1000 像素约多少字节，按「正文实占面积」（ink，页边距与页尾空白不计）折算。
 * 样本「sample-long」纯文字竖排页 1x 实测：逐页成品 58100/19724/55849/19627 B 对
 * ink 599.8/73.4/524.5/89.7 kpx 线性拟合得 76 字节/kpx（残差 ±5%）。
 * JPEG q92 比 PNG 贵 4 倍——文字边缘的振铃噪声吃掉了有损优势；含照片的文档 JPEG 会明显
 * 小于此值、带底纹装饰的文档 PNG 会更大，故预测只作量级参考。
 */
export const EXPORT_SIZE_BYTES_PER_KPX = { png: 76, jpeg: 322 } as const

/** 整幅一图（长图/合成大）是连续流重排：实测 8 页 ink 3100 kpx 合成图 212717 B，反推打包率 0.9 */
export const EXPORT_SIZE_FLOW_PACK = 0.9

/**
 * 高清档（3.125 倍截图）的字节超线性系数：像素只多 9.77 倍，成品却大 19~24 倍。
 * 1x 下几像素高的正文被 PNG 的字典压得极狠，放大后字形边缘的细节信息量按超线性上升。
 * 实测三例反推 2.17~2.54（全文长图 4719 KB、单页正文整幅 1107 KB、两页稀疏分页 232 KB），取 2.35；
 * 稀疏页的高清成品仍会高估三成，整档误差约 ±30%，原图档才是准的。
 */
export const EXPORT_SIZE_HD_FACTOR = 2.35

/**
 * 整幅一图的画布面积打包率（压缩模糊判据用，与上面的 ink 打包率不同源）：
 * 实测全文长图成品 5091×794 = 4044 kpx，逐页画布合计 7128 kpx，占 57%——连续流省掉页尾空白。
 * 取 0.6 略微高估，边界情况下宁可多提示一次压缩会糊。
 */
export const EXPORT_SIZE_FLOW_PX_PACK = 0.6

/** 逐页成品图的固定开销（KB）：整页底纹色带、页脚页码、装饰元素都按页重复绘制，与正文多少无关（实测约 14 KB/页） */
export const EXPORT_SIZE_PAGE_IMAGE_KB = 14

/** 整幅一图的固定开销（KB）：连续流里底纹只画一遍，只剩 PNG/JPEG 头与压缩字典（实测约 2 KB） */
export const EXPORT_SIZE_FLOW_IMAGE_KB = 2

/** ZIP 相对成品原样的比例：位图成品本身已压缩，打包几乎不再变小（实测 0.955） */
export const EXPORT_SIZE_ZIP_RATIO = 0.96

/** 体积读数（进度消息与界面预估共用同一口径） */
export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${Math.round(n)} B`
}

export interface ExportPageInfo {
  /** 全局页序（0 起），按页导出用它作为选中值 */
  index: number
  chapterId: string
  chapterTitle: string
  pageIndexInChapter: number
  widthCss: number
  heightCss: number
  /** 本页正文实际占用的 CSS 像素面积（内容长度 × 版心宽/高）：体积预测用，稀疏页远小于整页 */
  inkCss: number
}

export interface ExportOptions {
  docId: string
  title: string
  format: ExportFormat
  quality: ExportQuality
  /** 由 quality 派生的截图倍率：原图/压缩 = 1，高清 = 3.125（300DPI） */
  scale: number
  range: 'all' | 'chapters' | 'pages'
  chapterIds: string[] | null
  /** range = pages 时选中的页序（allPlans 下标） */
  pageIndices: number[] | null
  /** 长图拆分：全文一张 / 每章一张。界面不再暴露，仅无限画布「分章节 PNG」内部用 perChapter */
  longScope: 'doc' | 'perChapter'
  outputDir: string
}

export interface ExportProgress {
  phase: 'prepare' | 'render' | 'write' | 'zip' | 'done' | 'error'
  done: number
  total: number
  message: string
}

export interface ExportResult {
  outputDir: string
  files: string[]
  zipFile?: string
  /** 本次写盘的成品总字节数（含压缩包本体），供界面用实测校准预估 */
  totalBytes: number
}

export interface ExportCheckResult {
  warns: string[]
  infos: string[]
}

export interface ApiBridge {
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  docs: {
    list(): Promise<DocMeta[]>
    cards(): Promise<DocCardInfo[]>
    get(id: string): Promise<DocBundle>
    create(payload?: CreateDocPayload): Promise<DocMeta>
    save(id: string, payload: SaveDocPayload): Promise<SaveResult>
    copy(id: string): Promise<DocMeta>
    remove(id: string): Promise<void>
    updateMeta(id: string, patch: Partial<Pick<DocMeta, 'title' | 'tags' | 'folder'>>): Promise<DocMeta>
    search(query: string): Promise<SearchHit[]>
    importFromPaths(paths: string[]): Promise<DocMeta[]>
  }
  folders: {
    list(): Promise<DocFolder[]>
    create(path: string): Promise<DocFolder[]>
    remove(path: string): Promise<DocFolder[]>
  }
  assets: {
    import(docId: string, paths: string[]): Promise<ImportedAsset[]>
    /** 预设自带资源目录（data/presets/assets）：预设编辑选图走这条，不依赖任何文档 */
    importPreset(paths: string[]): Promise<ImportedAsset[]>
    saveData(docId: string, name: string, base64: string): Promise<ImportedAsset>
  }
  snapshots: {
    list(docId: string): Promise<SnapshotInfo[]>
    create(docId: string, payload?: { label?: string }): Promise<SnapshotInfo>
    get(docId: string, name: string): Promise<SnapshotData>
    remove(docId: string, name: string): Promise<SnapshotInfo[]>
  }
  dialog: {
    openFile(options?: FileDialogOptions): Promise<string[]>
    openDirectory(): Promise<string | null>
    saveFile(options?: SaveFileDialogOptions): Promise<string | null>
  }
  presets: {
    list(): Promise<Preset[]>
    save(preset: Preset): Promise<Preset[]>
    remove(id: string): Promise<Preset[]>
    importFromPaths(paths: string[]): Promise<Preset[]>
    exportToPath(path: string, ids: string[]): Promise<void>
  }
  export: {
    run(options: ExportOptions, bundle: DocBundle): Promise<ExportResult>
    checks(options: ExportOptions, bundle: DocBundle): Promise<ExportCheckResult>
    listPages(options: ExportOptions, bundle: DocBundle): Promise<ExportPageInfo[]>
  }
  fonts: {
    list(): Promise<SystemFont[]>
  }
  mobile: {
    status(): Promise<MobileStatus>
    setEnabled(enabled: boolean): Promise<MobileStatus>
    setPort(port: number): Promise<MobileStatus>
    rotateToken(): Promise<MobileStatus>
    /** PC 主动把文档推给手机（覆盖式）：手机在线则几秒内自动收取，否则暂存收件箱 */
    syncToPhone(docIds: string[]): Promise<MobileSyncResult>
  }
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  onMobileChanged(cb: (e: MobileChangedEvent) => void): () => void
  onMobileInboxAcked(cb: (e: MobileInboxAckedEvent) => void): () => void
  onMenuAction(
    cb: (action: 'import' | 'mobile' | 'settings' | 'presets' | 'home') => void
  ): () => void
  app: {
    info(): Promise<AppInfo>
  }
}
