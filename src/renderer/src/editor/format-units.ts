/** 文本格式相关的单位换算：磅/像素/毫米、中文字号、颜色 */

/** 1pt = 1/72 英寸；CSS px 按 96dpi */
export const PT_PER_PX = 72 / 96
export const PT_PER_MM = 72 / 25.4

export function pxToPt(px: number): number {
  return px * PT_PER_PX
}

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM
}

/** Word 中文字号 ↔ 磅值对照表（一英寸误写场景按标准磅值处理） */
export const CN_FONT_SIZES: { name: string; pt: number }[] = [
  { name: '初号', pt: 42 },
  { name: '小初', pt: 36 },
  { name: '一号', pt: 26 },
  { name: '小一', pt: 24 },
  { name: '二号', pt: 22 },
  { name: '小二', pt: 18 },
  { name: '三号', pt: 16 },
  { name: '小三', pt: 15 },
  { name: '四号', pt: 14 },
  { name: '小四', pt: 12 },
  { name: '五号', pt: 10.5 },
  { name: '小五', pt: 9 },
  { name: '六号', pt: 7.5 },
  { name: '小六', pt: 6.5 },
  { name: '七号', pt: 5.5 },
  { name: '八号', pt: 5 }
]

export function ptToCnName(pt: number): string {
  const hit = CN_FONT_SIZES.find((c) => Math.abs(c.pt - pt) < 0.01)
  return hit ? hit.name : ''
}

export function cnNameToPt(name: string): number | null {
  const hit = CN_FONT_SIZES.find((c) => c.name === name.trim())
  return hit ? hit.pt : null
}

/** 解析字号字符串（'18px' / '14pt' / '14'），统一返回磅值；无法解析返回 null */
export function parseSizeToPt(raw: string | null | undefined): number | null {
  if (!raw) return null
  const v = parseFloat(raw)
  if (!isFinite(v) || v <= 0) return null
  if (raw.includes('px')) return pxToPt(v)
  return v // pt 或无单位（历史数据按 px 存，这里仅在带 px 单位时换算）
}

/** 四舍五入到最近的 step 倍数（step=1 即取整） */
export function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step
}

/** 保留至多 1 位小数（避免 step=0.5 乘除产生浮点尾数） */
export function roundHalf(v: number): number {
  return Math.round(v * 2) / 2
}

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Hsv {
  h: number
  s: number
  v: number
}

const HEX_RE = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_RE6 = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

export function parseColor(input: string): Rgb | null {
  const m6 = HEX_RE6.exec(input.trim())
  if (m6) {
    return { r: parseInt(m6[1], 16), g: parseInt(m6[2], 16), b: parseInt(m6[3], 16) }
  }
  const m3 = HEX_RE.exec(input.trim())
  if (m3) {
    return {
      r: parseInt(m3[1] + m3[1], 16),
      g: parseInt(m3[2] + m3[2], 16),
      b: parseInt(m3[3] + m3[3], 16)
    }
  }
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(input.trim())
  if (rgb) {
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3] }
  }
  return null
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)))
}

const hex2 = (v: number): string => clamp255(v).toString(16).padStart(2, '0')

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const hh = (((h % 360) + 360) % 360) / 60
  const c = v * s
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = v - c
  const seg = Math.floor(hh) % 6
  const [r, g, b] = seg === 0 ? [c, x, 0] : seg === 1 ? [x, c, 0] : seg === 2 ? [0, c, x] : seg === 3 ? [0, x, c] : seg === 4 ? [x, 0, c] : [c, 0, x]
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}
