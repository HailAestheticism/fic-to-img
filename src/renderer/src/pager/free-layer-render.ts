import * as fabric from 'fabric'
import type { FreeElement } from '@shared/types'
import { enlivenElements } from '../freelay/fabric-service'
import type { PageGeometry } from './paginate'

/**
 * 把某图层的元素渲染进容器（容器的 .free-layer 定位决定其叠放位置）。
 * multiplier 用于导出高清图：canvas 背板 = 逻辑尺寸 × multiplier，
 * CSS 尺寸保持逻辑值，配合导出容器的 zoom 缩放后像素恰好 1:1。
 */
export async function renderFreeLayerInto(
  host: HTMLElement,
  list: FreeElement[],
  geo: PageGeometry,
  multiplier: number
): Promise<void> {
  host.innerHTML = ''
  if (!list.length) return
  const sc = new fabric.StaticCanvas(undefined, {
    width: geo.widthPx,
    height: geo.heightPx,
    enableRetinaScaling: false,
    renderOnAddRemove: false
  })
  sc.backgroundColor = 'transparent'
  try {
    const objs = await enlivenElements(list)
    objs.forEach((o) => sc.add(o))
    sc.renderAll()
    const el = sc.toCanvasElement(multiplier)
    el.style.position = 'absolute'
    el.style.inset = '0'
    el.style.width = `${geo.widthPx}px`
    el.style.height = `${geo.heightPx}px`
    el.style.pointerEvents = 'none'
    host.appendChild(el)
  } finally {
    sc.dispose()
  }
}
