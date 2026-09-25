import type { DocLayout, ExportOptions } from '@shared/types'
import { COMPRESS_BLUR_PIXEL_LIMIT } from '@shared/types'
import type { PageGeometry, PagePlan } from '../pager/paginate'
import type { ExportCheckResult } from '@shared/types'

interface CheckContext {
  plans: PagePlan[]
  geo: PageGeometry
  layout: DocLayout
  container: HTMLElement
  options: ExportOptions
  /** 每张成品导出图的估算像素尺寸 */
  imageSizes: { widthPx: number; heightPx: number }[]
}

/** 六项导出检查：溢出 / 跨页整块 / 字体缺失 / 图片 DPI / 元素越界 / 元素遮挡 */
export function runExportChecks(ctx: CheckContext): ExportCheckResult {
  const warns: string[] = []
  const infos: string[] = []
  const { plans, geo, layout, container, options, imageSizes } = ctx

  // 1+2. 内容溢出（含整块保留的图片/表格超高）
  const overflowPages = plans.filter((p) => p.overflow)
  if (overflowPages.length) {
    warns.push(
      `${overflowPages.length} 页内容超高无法完整放下（第 ${overflowPages
        .map((p) => plans.indexOf(p) + 1)
        .join('、')} 页），超出部分将被裁切。建议：缩小图片/表格、调大页面或调小字号。`
    )
  }
  for (const p of overflowPages) {
    const hasTableOrImage = p.items.some(
      (it) => it.node.type.name === 'table' || it.node.type.name === 'image'
    )
    if (hasTableOrImage) {
      infos.push('检测到图片/表格整块不拆分，跨页时会整体移到下一页，注意排版留白。')
      break
    }
  }

  // 3. 字体缺失
  const families = new Set<string>()
  families.add(layout.typography.bodyFont)
  families.add(layout.typography.headingFont)
  for (const el of layout.freeElements) {
    const f = (el.data as Record<string, any>).fontFamily
    if (typeof f === 'string' && f) families.add(f)
  }
  for (const fam of families) {
    let ok = true
    try {
      ok = document.fonts.check(`16px "${fam}"`)
    } catch {
      ok = true
    }
    if (!ok) warns.push(`本机未安装字体「${fam}」，导出时会以默认字体替代。`)
  }

  // 4. 图片有效 DPI
  const imgs = Array.from(container.querySelectorAll('img'))
  let lowDpi = 0
  for (const img of imgs) {
    const natural = (img as HTMLImageElement).naturalWidth
    const cssW = img.getBoundingClientRect().width
    if (!natural || !cssW) continue
    const dpi = natural / (cssW / 96)
    if (dpi < 150) lowDpi++
  }
  if (lowDpi) {
    warns.push(`${lowDpi} 张图片有效分辨率低于 150DPI，导出后可能模糊。建议更换更高清的原图。`)
  }

  // 5+6. 自由元素越界 / 遮挡正文
  const contentBox = { x: geo.marginLeftPx, y: geo.marginTopPx, w: geo.contentWidthPx, h: geo.contentHeightPx }
  let outOfBounds = 0
  let occlude = 0
  for (const el of layout.freeElements) {
    const d = el.data as Record<string, any>
    const w = (d.width ?? 0) * (d.scaleX ?? 1)
    const h = (d.height ?? 0) * (d.scaleY ?? 1)
    const left = d.left ?? 0
    const top = d.top ?? 0
    const r = { l: left, t: top, r: left + w, b: top + h }
    const outside =
      r.l < -2 || r.t < -2 || r.r > geo.widthPx + 2 || r.b > geo.heightPx + 2
    if (outside) {
      outOfBounds++
      continue
    }
    const overlaps =
      r.l < contentBox.x + contentBox.w &&
      r.r > contentBox.x &&
      r.t < contentBox.y + contentBox.h &&
      r.b > contentBox.y
    if (overlaps && el.kind !== 'watermark' && (el.data as Record<string, any>).type !== 'path') {
      occlude++
    }
  }
  if (outOfBounds) {
    warns.push(`${outOfBounds} 个自由元素超出页面边界，导出时超出部分会被裁切。`)
  }
  if (occlude) {
    infos.push(`${occlude} 个自由元素与正文区域重叠（遮挡提示，请确认是否为有意设计）。`)
  }

  // 自由元素越界提示补充元素数量
  if (!layout.freeElements.length) {
    infos.push('本文档未使用自由排版元素。')
  }

  // 7. 压缩档模糊预警：JPEG 每像素低于约 1 字节时文字边缘出现可见伪影
  if (options.quality === 'compressed') {
    const over = imageSizes.map((s) => s.widthPx * s.heightPx).filter((px) => px > COMPRESS_BLUR_PIXEL_LIMIT)
    if (over.length) {
      const max = Math.max(...over)
      warns.push(
        `图片尺寸过大（${over.length} 张成品图超过 200 万像素，最大约 ${Math.round(max / 10000)} 万像素），压缩到 2MB 及以下会导致文字模糊，建议分章节/分页导出。`
      )
    } else {
      infos.push('压缩档：单张成品图将控制在 2MB 以内（超过时自动转 JPEG 逐级降质）。')
    }
  }

  return { warns, infos }
}
