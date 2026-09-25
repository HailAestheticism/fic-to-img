import type { BackgroundSpec, ImageAnchor, MultiImageSpec } from '@shared/types'

/** 图片原始尺寸缓存：错位平铺/多图需要按原图比例布局，加载一次即复用 */
const sizeCache = new Map<string, Promise<{ w: number; h: number }>>()

function imageSize(url: string | undefined): Promise<{ w: number; h: number }> {
  if (!url) return Promise.resolve({ w: 1, h: 1 })
  const hit = sizeCache.get(url)
  if (hit) return hit
  const p = new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image()
    img.onload = (): void => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 })
    img.onerror = (): void => resolve({ w: 1, h: 1 })
    img.src = url
  })
  sizeCache.set(url, p)
  return p
}

function cssUrl(url: string): string {
  return `url("${url.replace(/"/g, '%22')}")`
}

/** 锚点 → background-position 的横向百分比（平铺时该百分比即铺贴相位） */
function anchorX(a: ImageAnchor | undefined): string {
  return a === 'tl' ? '0%' : a === 'tr' ? '100%' : '50%'
}

function anchorKeyword(a: ImageAnchor | undefined): string {
  return a === 'tl' ? 'left' : a === 'tr' ? 'right' : 'center'
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  return e
}

/** 平铺 / 错位平铺：错位用两层同图，第二层相位偏移半张图 */
function tileStyle(
  st: CSSStyleDeclaration,
  url: string,
  size: { w: number; h: number },
  anchor: ImageAnchor,
  offset: boolean
): void {
  const x = anchorX(anchor)
  const base = `${x} 0%`
  if (!offset) {
    st.backgroundImage = cssUrl(url)
    st.backgroundSize = `${size.w}px ${size.h}px`
    st.backgroundPosition = base
    st.backgroundRepeat = 'repeat'
    return
  }
  const half = `calc(${x} + ${size.w / 2}px) ${size.h / 2}px`
  st.backgroundImage = `${cssUrl(url)}, ${cssUrl(url)}`
  st.backgroundSize = `${size.w}px ${size.h}px, ${size.w}px ${size.h}px`
  st.backgroundPosition = `${base}, ${half}`
  st.backgroundRepeat = 'repeat, repeat'
}

/** 中间区域（多图模式）的填充 */
function applyMid(st: CSSStyleDeclaration, mid: MultiImageSpec | undefined, size: { w: number; h: number }): void {
  const kind = mid?.midKind ?? 'image'
  if (kind === 'color') {
    st.backgroundColor = mid?.midColor || '#ffffff'
    return
  }
  if (kind === 'gradient') {
    st.backgroundImage = mid?.midGradient || 'linear-gradient(180deg, #ffffff 0%, #f2efe9 100%)'
    return
  }
  const url = mid?.midUrl
  if (!url) return
  const fit = mid?.midFit ?? 'fill'
  const anchor = mid?.midAnchor ?? 'center'
  if (fit === 'stretch') {
    st.backgroundImage = cssUrl(url)
    st.backgroundSize = '100% 100%'
    st.backgroundRepeat = 'no-repeat'
    return
  }
  if (fit === 'tile' || fit === 'offset-tile') {
    tileStyle(st, url, size, anchor, fit === 'offset-tile')
    return
  }
  st.backgroundImage = cssUrl(url)
  st.backgroundSize = 'cover'
  st.backgroundPosition = `${anchorKeyword(anchor)} top`
  st.backgroundRepeat = 'no-repeat'
}

/**
 * 把背景规格铺到目标元素（需为定位元素，内部绝对定位一层）。
 * 纯色/渐变直接写在目标上；图片类另建 .paper-bg-layer。
 */
export async function applyBackgroundSpec(
  target: HTMLElement,
  bg: BackgroundSpec | null | undefined
): Promise<void> {
  target.style.backgroundColor = ''
  target.style.backgroundImage = ''
  target.style.backgroundRepeat = ''
  target.style.backgroundSize = ''
  target.style.backgroundPosition = ''
  target.querySelectorAll('.paper-bg-layer').forEach((n) => n.remove())
  if (!bg) return

  if (bg.kind === 'color') {
    if (bg.color) target.style.backgroundColor = bg.color
    return
  }
  if (bg.kind === 'gradient') {
    if (bg.gradient) target.style.backgroundImage = bg.gradient
    return
  }

  if (bg.kind === 'texture') {
    // 旧数据兼容：纹理即左上角平铺
    await applyBackgroundSpec(target, {
      kind: 'image',
      imageUrl: bg.textureUrl,
      imageFit: 'tile',
      imageAnchor: 'tl'
    })
    return
  }
  const fit = bg.imageFit ?? 'fill'
  const anchor = bg.imageAnchor ?? 'center'
  const url = bg.imageUrl
  const layer = el('div', 'paper-bg-layer')
  layer.style.opacity = String(bg.imageOpacity ?? 1)

  if (fit === 'multi') {
    const multi = bg.multi ?? {}
    const [top, bottom, mid] = await Promise.all([
      imageSize(multi.topUrl),
      imageSize(multi.bottomUrl),
      imageSize(multi.midUrl)
    ])
    layer.classList.add('paper-bg-multi')
    if (multi.topUrl) {
      const band = el('div', 'bgm-band')
      band.style.backgroundImage = cssUrl(multi.topUrl)
      band.style.backgroundSize = '100% 100%'
      band.style.aspectRatio = `${top.w} / ${top.h}`
      layer.appendChild(band)
    }
    const midEl = el('div', 'bgm-mid')
    applyMid(midEl.style, multi, mid)
    layer.appendChild(midEl)
    if (multi.bottomUrl) {
      const band = el('div', 'bgm-band')
      band.style.backgroundImage = cssUrl(multi.bottomUrl)
      band.style.backgroundSize = '100% 100%'
      band.style.aspectRatio = `${bottom.w} / ${bottom.h}`
      layer.appendChild(band)
    }
    target.prepend(layer)
    return
  }

  if (!url) return
  if (fit === 'stretch') {
    layer.style.backgroundImage = cssUrl(url)
    layer.style.backgroundSize = '100% 100%'
    layer.style.backgroundRepeat = 'no-repeat'
    target.prepend(layer)
    return
  }
  if (fit === 'tile' || fit === 'offset-tile') {
    const size = await imageSize(url)
    tileStyle(layer.style, url, size, anchor, fit === 'offset-tile')
    target.prepend(layer)
    return
  }
  layer.style.backgroundImage = cssUrl(url)
  layer.style.backgroundSize = 'cover'
  layer.style.backgroundPosition = `${anchorKeyword(anchor)} top`
  layer.style.backgroundRepeat = 'no-repeat'
  target.prepend(layer)
}
