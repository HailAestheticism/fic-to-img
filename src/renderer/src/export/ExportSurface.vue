<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { DocBundle, ExportCheckResult, ExportOptions } from '@shared/types'
import { computeGeometry, geometryForPlan, isVerticalFlow, paginateDoc } from '../pager/paginate'
import type { PageGeometry, PagePlan } from '../pager/paginate'
import { runExportChecks } from './checks'
import { buildFullPageEl, buildLongFlowEl, buildPlansFlowEl, createExportEditor, settle, type ExportEditor } from './render-shared'

interface ExportPayload {
  options: ExportOptions
  bundle: DocBundle
}

/** 整幅成图要画哪一段：全文 / 单章 / 所选页首尾相接（合成大图） */
export interface LongSelection {
  kind: 'doc' | 'chapter' | 'plans'
  chapterId?: string | null
}

const stageEl = ref<HTMLDivElement>()

let payload: ExportPayload | null = null
let ed: ExportEditor | null = null
let allPlans: PagePlan[] = []
let selectedPlans: PagePlan[] = []
let geo: PageGeometry | null = null

/** 导出用整页：按该页几何建页 + 两个图层的静态画布 */
async function buildExportPage(plan: PagePlan, multiplier: number): Promise<{ el: HTMLElement; geo: PageGeometry }> {
  return buildFullPageEl({
    bundle: payload!.bundle,
    plan,
    pageNumber: allPlans.indexOf(plan) + 1,
    totalPages: allPlans.length,
    serializer: ed!.serializer,
    multiplier
  })
}

onMounted(() => {
  document.body.style.margin = '0'
  document.body.style.background = '#fff'

  const api = {
    init(p: ExportPayload): void {
      payload = p
      ed = createExportEditor(p.bundle)
      geo = computeGeometry(p.bundle.layout)
      allPlans = paginateDoc(ed.editor.state.doc, ed.editor.schema, p.bundle.layout, p.bundle.meta.title)
      const selected = new Set<number>()
      if (p.options.range === 'chapters') {
        const ids = new Set(p.options.chapterIds ?? [])
        allPlans.forEach((pl, i) => {
          if (ids.has(pl.chapterId)) selected.add(i)
        })
      } else if (p.options.range === 'pages') {
        for (const i of p.options.pageIndices ?? []) selected.add(i)
      }
      selectedPlans = p.options.range === 'all' ? allPlans : allPlans.filter((_, i) => selected.has(i))
    },

    begin(): unknown {
      const ids: string[] = []
      const titles: string[] = []
      for (const p of selectedPlans) {
        if (!ids.includes(p.chapterId)) {
          ids.push(p.chapterId)
          titles.push(p.chapterTitle)
        }
      }
      return {
        pages: selectedPlans.length,
        total: allPlans.length,
        chapterIds: ids,
        chapterTitles: titles
      }
    },

    listPages(): unknown {
      if (!payload) return []
      const layout = payload.bundle.layout
      const vert = isVerticalFlow(layout)
      return allPlans.map((pl, i) => {
        const g = geometryForPlan(layout, pl)
        return {
          index: i,
          chapterId: pl.chapterId,
          chapterTitle: pl.chapterTitle,
          pageIndexInChapter: pl.pageIndexInChapter,
          widthCss: g.widthPx,
          heightCss: g.heightPx,
          // 竖排沿宽度推进，正文长度乘以版心高；横排反之
          inkCss: pl.contentPx * (vert ? g.contentHeightPx : g.contentWidthPx)
        }
      })
    },

    async renderPage(i: number): Promise<unknown> {
      const plan = selectedPlans[i]
      if (!plan || !payload) return null
      const stage = stageEl.value!
      stage.innerHTML = ''
      const { el, geo: g } = await buildExportPage(plan, payload.options.scale)
      stage.appendChild(el)
      await settle(el)
      return {
        chapterId: plan.chapterId,
        chapterTitle: plan.chapterTitle,
        pageIndexInChapter: plan.pageIndexInChapter,
        widthCss: g.widthPx,
        heightCss: g.heightPx
      }
    },

    /** 长图/合成大图：构建连续流内容，返回逻辑尺寸 */
    async prepareLongImage(sel: LongSelection): Promise<{ widthCss: number; heightCss: number } | null> {
      if (!geo || !payload) return null
      const stage = stageEl.value!
      stage.innerHTML = ''
      stage.style.transform = ''
      document.documentElement.style.overflow = 'hidden'
      const built =
        sel.kind === 'plans'
          ? await buildPlansFlowEl({
              bundle: payload.bundle,
              serializer: ed!.serializer,
              geo,
              plans: selectedPlans
            })
          : await buildLongFlowEl({
              bundle: payload.bundle,
              editor: ed!.editor,
              serializer: ed!.serializer,
              geo,
              chapterId: sel.kind === 'chapter' ? (sel.chapterId ?? null) : null
            })
      stage.appendChild(built.el)
      return { widthCss: built.widthCss, heightCss: built.heightCss }
    },

    async scrollLong(yCss: number, xCss = 0): Promise<void> {
      const stage = stageEl.value!
      stage.style.transform = xCss || yCss ? `translate(${-xCss}px, ${-yCss}px)` : ''
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    },

    async runChecks(): Promise<ExportCheckResult> {
      if (!geo || !payload) return { warns: [], infos: [] }
      const stage = stageEl.value!
      stage.innerHTML = ''
      const box = document.createElement('div')
      box.style.position = 'absolute'
      box.style.left = '-100000px'
      box.style.top = '0'
      for (const plan of selectedPlans) {
        const { el } = await buildExportPage(plan, 1)
        box.appendChild(el)
        await settle(el)
      }
      stage.appendChild(box)
      const result = runExportChecks({
        plans: selectedPlans,
        geo,
        layout: payload.bundle.layout,
        container: box,
        options: payload.options,
        imageSizes: estimateImageSizes(payload.options)
      })
      stage.innerHTML = ''
      return result
    }
  }

  /** 估算每张成品导出图的像素尺寸（整幅成图高度按所选页高累加近似），供压缩档模糊预警 */
  function estimateImageSizes(options: ExportOptions): { widthPx: number; heightPx: number }[] {
    const layout = payload!.bundle.layout
    const size = (p: PagePlan | undefined) => geometryForPlan(layout, p)
    const total = (ps: PagePlan[]) => {
      let h = 0
      for (const p of ps) h += size(p).heightPx
      return { widthPx: size(ps[0])?.widthPx ?? 0, heightPx: h }
    }
    if (options.format === 'long' || options.format === 'jpeg') {
      return [total(options.range === 'all' ? allPlans : selectedPlans)]
    }
    if (options.format === 'chapterZip') {
      const byChapter = new Map<string, PagePlan[]>()
      for (const p of selectedPlans) {
        const list = byChapter.get(p.chapterId)
        if (list) list.push(p)
        else byChapter.set(p.chapterId, [p])
      }
      return Array.from(byChapter.values(), total).filter((s) => s.heightPx > 0)
    }
    return selectedPlans.map((p) => size(p))
  }

  ;(window as unknown as Record<string, unknown>).__exportApi = api
  ;(window as unknown as Record<string, unknown>).__exportReady = true
})
</script>

<template>
  <div id="export-stage" ref="stageEl" />
</template>
