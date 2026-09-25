import type { CustomCanvas, ImageAnchor, ImageFit, PageSetup, Typography } from './types'

/** mm → CSS px（96dpi），与分页器一致 */
export function mmToPx(mm: number): number {
  return (mm * 96) / 25.4
}

export function pxToMm(px: number): number {
  return (px * 25.4) / 96
}

/** 图片铺法与锚点的中文名：面板、总览、卡片详情共用 */
export const IMAGE_FIT_LABELS: Record<ImageFit, string> = {
  fill: '充满',
  stretch: '拉伸',
  tile: '平铺',
  'offset-tile': '错位平铺',
  multi: '多图'
}

export const IMAGE_ANCHOR_LABELS: Record<ImageAnchor, string> = {
  tl: '左上角',
  center: '居中',
  tr: '右上角'
}

/** 仅这三种铺法有锚点可选 */
export const ANCHORED_FITS: ImageFit[] = ['fill', 'tile', 'offset-tile']

/** 画布预设类目：印刷品（国际标准纸张 / 书籍小开本 / 中开本）与显示器 */
export type CanvasGroupId = 'paper' | 'smallBook' | 'mediumBook' | 'screen'

export interface CanvasPreset {
  key: string
  label: string
  group: CanvasGroupId
  /** 以 px 定义的画布（屏幕类）换算成 mm 存储 */
  widthPx?: number
  heightPx?: number
  widthMm: number
  /** 无限长度画布省略 */
  heightMm?: number
  infiniteHeight?: boolean
  margins?: { top: number; right: number; bottom: number; left: number }
  typography?: Partial<Pick<Typography, 'bodySize' | 'bodyLineHeight'>>
  plainHeaderFooter?: boolean
}

const px = (v: number): number => Math.round(pxToMm(v) * 100) / 100

export const CANVAS_GROUPS: { id: CanvasGroupId; label: string }[] = [
  { id: 'paper', label: '国际标准纸张' },
  { id: 'smallBook', label: '书籍小开本' },
  { id: 'mediumBook', label: '书籍中开本' },
  { id: 'screen', label: '显示器' }
]

/**
 * 印刷品页边距按书籍装订惯例：天头 > 地脚、订口 > 切口。
 * 屏幕类：小红书卡片按「一行 15 字、1 字宽 < 页边距 < 2 字宽」推得 60px 字号 + 90px 边距；
 * 手机长图取微信公众号排版惯例（1080px 稿宽、16 逻辑 px 侧边距 → 48px）。
 */
export const CANVAS_PRESETS: CanvasPreset[] = [
  {
    key: 'A4',
    label: 'A4',
    group: 'paper',
    widthMm: 210,
    heightMm: 297,
    margins: { top: 25, right: 18, bottom: 22, left: 20 }
  },
  {
    key: 'A5',
    label: 'A5',
    group: 'paper',
    widthMm: 148,
    heightMm: 210,
    margins: { top: 18, right: 13, bottom: 16, left: 15 },
    typography: { bodySize: 14 }
  },
  {
    key: 'B5',
    label: 'B5',
    group: 'paper',
    widthMm: 176,
    heightMm: 250,
    margins: { top: 20, right: 15, bottom: 18, left: 17 }
  },
  {
    key: 'k32',
    label: '32开',
    group: 'smallBook',
    widthMm: 130,
    heightMm: 184,
    margins: { top: 18, right: 11, bottom: 16, left: 14 },
    typography: { bodySize: 13 }
  },
  {
    key: 'k32s',
    label: '小32开',
    group: 'smallBook',
    widthMm: 115,
    heightMm: 156,
    margins: { top: 16, right: 10, bottom: 14, left: 12 },
    typography: { bodySize: 12.5 }
  },
  {
    key: 'k64',
    label: '64开',
    group: 'smallBook',
    widthMm: 92,
    heightMm: 129,
    margins: { top: 13, right: 8, bottom: 11, left: 10 },
    typography: { bodySize: 11.5 }
  },
  {
    key: 'k16',
    label: '16开',
    group: 'mediumBook',
    widthMm: 185,
    heightMm: 260,
    margins: { top: 22, right: 15, bottom: 20, left: 18 }
  },
  {
    key: 'k16l',
    label: '大16开',
    group: 'mediumBook',
    widthMm: 210,
    heightMm: 285,
    margins: { top: 24, right: 17, bottom: 22, left: 20 }
  },
  {
    key: 'k8',
    label: '8开',
    group: 'mediumBook',
    widthMm: 260,
    heightMm: 370,
    margins: { top: 28, right: 20, bottom: 26, left: 24 },
    typography: { bodySize: 18 }
  },
  {
    key: 'xhs',
    label: '小红书卡片',
    group: 'screen',
    widthMm: px(1080),
    heightMm: px(1920),
    widthPx: 1080,
    heightPx: 1920,
    margins: { top: px(90), right: px(90), bottom: px(90), left: px(90) },
    typography: { bodySize: 60, bodyLineHeight: '1.6' },
    plainHeaderFooter: true
  },
  {
    key: 'pcLong',
    label: 'PC长图',
    group: 'screen',
    widthMm: 210,
    infiniteHeight: true,
    margins: { top: 33, right: 18, bottom: 22, left: 18 },
    plainHeaderFooter: true
  },
  {
    key: 'mobileLong',
    label: '手机长图',
    group: 'screen',
    widthMm: px(1080),
    widthPx: 1080,
    infiniteHeight: true,
    margins: { top: px(56), right: px(48), bottom: px(72), left: px(48) },
    typography: { bodySize: 32, bodyLineHeight: '1.75' },
    plainHeaderFooter: true
  }
]

/** 新建文档默认套用的画布预设（全局规则：PC长图——210mm 宽、无限长、无页眉页脚） */
export const NEW_DOC_CANVAS_KEY = 'pcLong'

/** 自定义尺寸 → 画布预设形状（无推荐排版；group 仅占位，不参与判定） */
export function customToPreset(c: CustomCanvas): CanvasPreset {
  return {
    key: c.id,
    label: c.label,
    group: 'paper',
    widthMm: c.widthMm,
    heightMm: c.heightMm,
    infiniteHeight: c.infiniteHeight,
    margins: c.margins
  }
}

/**
 * 解析「新建文档默认画布」引用：先按系统预设 key 找，再按自定义尺寸 id 找；
 * 两处都落空（未设置、或引用的自定义尺寸已被删除）时回退 NEW_DOC_CANVAS_KEY。
 */
export function resolveDefaultCanvas(
  ref: string | undefined,
  customs: CustomCanvas[] | undefined
): CanvasPreset {
  const preset = CANVAS_PRESETS.find((p) => p.key === ref)
  if (preset) return preset
  const custom = (customs ?? []).find((c) => c.id === ref)
  if (custom) return customToPreset(custom)
  return CANVAS_PRESETS.find((p) => p.key === NEW_DOC_CANVAS_KEY) as CanvasPreset
}

export function findPreset(
  widthMm: number,
  heightMm: number,
  infinite = false
): CanvasPreset | undefined {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.6
  return CANVAS_PRESETS.find((p) => {
    if (!!p.infiniteHeight !== infinite) return false
    if (!near(p.widthMm, widthMm)) return false
    return infinite || near(p.heightMm ?? 0, heightMm)
  })
}

/** 画布显示名：命中预设用名字，否则显示尺寸 */
export function paperLabel(widthMm: number, heightMm: number, infinite = false): string {
  const hit = findPreset(widthMm, heightMm, infinite)
  if (hit) return hit.label
  return infinite ? `${Math.round(widthMm)}×无限` : `${Math.round(widthMm)}×${Math.round(heightMm)}`
}

/** 文档尺寸类别：决定卡片左上角图标的形态 */
export type SizeCategory = 'mobile' | 'web' | 'book' | 'paper'

const SCREEN_KEYS = new Set(CANVAS_PRESETS.filter((p) => p.group === 'screen').map((p) => p.key))
const SMALL_KEYS = new Set(['k32', 'k32s', 'k64'])
const MEDIUM_KEYS = new Set(['k16', 'k16l', 'k8'])

/** 常见明信片/标准卡片类纸张（竖版 mm，横版自动镜像匹配） */
const STANDARD_CARDS: [number, number][] = [
  [100, 148], [102, 153], [105, 148], [110, 165], [120, 165], [120, 170], [125, 178], [128, 178], [148, 210]
]

export function sizeCategory(widthMm: number, heightMm: number, infinite = false): SizeCategory {
  const hit = findPreset(widthMm, heightMm, infinite)
  if (hit) {
    if (SCREEN_KEYS.has(hit.key)) return infinite ? 'mobile' : 'web'
    if (SMALL_KEYS.has(hit.key) || MEDIUM_KEYS.has(hit.key)) return 'book'
    return 'paper'
  }
  const w = Math.min(widthMm, heightMm)
  const h = Math.max(widthMm, heightMm)
  if (infinite || h / w >= 1.7) return 'mobile'
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 2.5
  if (STANDARD_CARDS.some(([cw, ch]) => near(w, cw) && near(h, ch))) return 'paper'
  if (widthMm >= heightMm) return 'web'
  return 'book'
}

export const SIZE_CATEGORY_LABELS: Record<SizeCategory, string> = {
  mobile: '手机页面',
  web: '电脑网页页面',
  book: '书籍印刷尺寸',
  paper: '标准纸张'
}

/** 套用画布预设：返回需要合并进 layout 的补丁 */
export function canvasPatch(
  preset: CanvasPreset,
  pageSetup: PageSetup,
  typography: Typography
): { pageSetup: PageSetup; typography: Typography } {
  const next: PageSetup = {
    ...pageSetup,
    widthMm: preset.widthMm,
    heightMm: preset.heightMm ?? pageSetup.heightMm,
    infiniteHeight: !!preset.infiniteHeight
  }
  if (preset.margins) {
    next.marginTopMm = preset.margins.top
    next.marginRightMm = preset.margins.right
    next.marginBottomMm = preset.margins.bottom
    next.marginLeftMm = preset.margins.left
  }
  if (preset.plainHeaderFooter) {
    next.header = { ...next.header, enabled: false }
    next.footer = { ...next.footer, enabled: false, showPageNumber: false }
  }
  return {
    pageSetup: next,
    typography: preset.typography ? { ...typography, ...preset.typography } : typography
  }
}
