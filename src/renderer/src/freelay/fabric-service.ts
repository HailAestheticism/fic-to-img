import * as fabric from 'fabric'
import type { DocLayout, FreeElement, LayoutLayer } from '@shared/types'
import { genId } from '../editor/id'
import type { PageGeometry, PagePlan } from '../pager/paginate'

declare module 'fabric' {
  interface FabricObject {
    elementId?: string
  }
}

export type ElementScope = FreeElement['scope']
export type ElementKind = FreeElement['kind']

/** 元素作用域是否命中某页 */
export function scopeMatchesPage(scope: ElementScope, plan: PagePlan): boolean {
  if (scope.type === 'global') return true
  if (scope.type === 'chapter') return scope.chapterId === plan.chapterId
  return scope.chapterId === plan.chapterId && scope.pageIndex === plan.pageIndexInChapter
}

/** 某页某图层适用的全部元素（数组序即叠放序，后加入者在上） */
export function elementsForLayer(
  layout: DocLayout,
  plan: PagePlan,
  layer: LayoutLayer
): FreeElement[] {
  return layout.freeElements.filter((e) => (e.layer ?? 'bg') === layer && scopeMatchesPage(e.scope, plan))
}

/** 从存储 schema 复原 Fabric 对象（带 elementId） */
export async function enlivenElements(list: FreeElement[]): Promise<fabric.FabricObject[]> {
  if (!list.length) return []
  const objs = (await fabric.util.enlivenObjects(
    list.map((e) => JSON.parse(JSON.stringify(e.data)))
  )) as fabric.FabricObject[]
  objs.forEach((o, i) => o.set('elementId', list[i].id))
  return objs as fabric.FabricObject[]
}

function place(obj: fabric.FabricObject, geo: PageGeometry): fabric.FabricObject {
  obj.set({
    left: geo.widthPx / 2 - (obj.width ?? 0) / 2,
    top: geo.heightPx / 2 - (obj.height ?? 0) / 2
  })
  return obj
}

export function createShapeObject(
  variant: 'rect' | 'circle' | 'triangle',
  geo: PageGeometry
): fabric.FabricObject {
  const common = {
    fill: 'rgba(138, 109, 59, 0.16)',
    stroke: '#8a6d3b',
    strokeWidth: 2,
    strokeUniform: true
  }
  if (variant === 'circle') {
    return place(new fabric.Circle({ ...common, radius: 70 }), geo)
  }
  if (variant === 'triangle') {
    return place(new fabric.Triangle({ ...common, width: 150, height: 130 }), geo)
  }
  return place(new fabric.Rect({ ...common, width: 180, height: 130 }), geo)
}

export function createLineObject(geo: PageGeometry): fabric.FabricObject {
  const y = geo.heightPx / 2
  return new fabric.Line([geo.widthPx / 2 - 120, y, geo.widthPx / 2 + 120, y], {
    stroke: '#8a6d3b',
    strokeWidth: 3,
    strokeUniform: true
  })
}

export function createTextObject(geo: PageGeometry, watermark: boolean): fabric.FabricObject {
  if (watermark) {
    return place(
      new fabric.IText('水印文字', {
        fontSize: 56,
        fill: 'rgba(130, 120, 110, 0.22)',
        fontFamily: 'Microsoft YaHei',
        angle: -28
      }),
      geo
    )
  }
  return place(
    new fabric.IText('双击编辑文字', {
      fontSize: 30,
      fill: '#2f2a26',
      fontFamily: 'Microsoft YaHei'
    }),
    geo
  )
}

export async function createStickerObject(
  src: string,
  geo: PageGeometry
): Promise<fabric.FabricObject> {
  const img = await fabric.FabricImage.fromURL(src, { crossOrigin: null })
  const maxW = Math.min(320, geo.widthPx * 0.6)
  if ((img.width ?? maxW) > maxW) img.scaleToWidth(maxW)
  return place(img, geo)
}

/** 无法从存储推断时按 Fabric 类型猜测元素 kind */
export function inferKind(obj: fabric.FabricObject): ElementKind {
  const t = obj.type?.toLowerCase?.() ?? ''
  if (t === 'path') return 'draw'
  if (t === 'image') return 'sticker'
  if (t === 'line') return 'line'
  if (t.includes('text')) return 'text'
  return 'shape'
}
