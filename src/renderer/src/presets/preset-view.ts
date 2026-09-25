import type { DocLayout, PMNode, Preset, PresetKind, Typography } from '@shared/types'
import { defaultLayout } from '@shared/layout'

export const KIND_LABELS: Record<PresetKind, string> = {
  pageSetup: '页面设置',
  typography: '文本样式',
  background: '背景',
  combined: '整套主题'
}

export type PresetSection = 'pageSetup' | 'typography' | 'background'

/** 预设类型决定它携带哪些样式，编辑器只展示可编辑的那几段 */
export function sectionsOf(kind: PresetKind): PresetSection[] {
  if (kind === 'combined') return ['pageSetup', 'typography', 'background']
  return kind === 'pageSetup' || kind === 'typography' || kind === 'background' ? [kind] : []
}

/** 预设 → 完整版面：未携带的字段回落默认值，图层元素与章节不参与预览 */
export function layoutFromPreset(p: { data: Preset['data'] }, base = defaultLayout()): DocLayout {
  return {
    ...base,
    pageSetup: p.data.pageSetup ? JSON.parse(JSON.stringify(p.data.pageSetup)) : base.pageSetup,
    typography: p.data.typography ? JSON.parse(JSON.stringify(p.data.typography)) : base.typography,
    backgrounds: {
      global: p.data.background ? JSON.parse(JSON.stringify(p.data.background)) : null,
      chapter: {},
      page: {}
    },
    chapters: {},
    freeElements: []
  }
}

/** 空值清洗：数字框留空会得到 ''，落库前必须转回 undefined */
export function sanitizeTypography(t: Typography): Typography {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && isFinite(v) ? v : undefined
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  return {
    ...t,
    h0Scale: num(t.h0Scale),
    h4Scale: num(t.h4Scale),
    h5Scale: num(t.h5Scale),
    h6Scale: num(t.h6Scale),
    spaceBeforePt: num(t.spaceBeforePt),
    spaceAfterPt: num(t.spaceAfterPt),
    defaultTextIndent: str(t.defaultTextIndent)
  }
}

/** 预设预览用的固定测试正文：大标题 + 一级~三级标题、正文、引用、列表、表格、分割线；首块文本即预设名 */
export function presetSampleContent(h0 = '文档标题（大标题）'): PMNode {
  const p = (text: string): PMNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const h = (level: number, text: string): PMNode => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }]
  })
  return {
    type: 'doc',
    content: [
      { type: 'docTitle', content: [{ type: 'text', text: h0 }] },
      h(1, '一级标题示例'),
      p('正文段落：字体、字号、行距与颜色都会在这里显形，长句换行后能看清版心的疏密。'),
      h(2, '二级标题示例'),
      p('第二段正文，用来观察段间距与首行缩进的效果。预设只改样式，不改这段测试文字的内容。'),
      { type: 'blockquote', content: [p('引用示例——适合放箴言或摘要。')] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [p('列表项一')] },
          { type: 'listItem', content: [p('列表项二')] }
        ]
      },
      h(3, '三级标题示例'),
      {
        type: 'table',
        attrs: { withHeaderRow: true },
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [p('项目')]
              },
              {
                type: 'tableHeader',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [p('示例')]
              }
            ]
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [p('表格')]
              },
              {
                type: 'tableCell',
                attrs: { colspan: 1, rowspan: 1, colwidth: null },
                content: [p('样式')]
              }
            ]
          }
        ]
      },
      { type: 'horizontalRule' },
      p('测试文本到此为止，编辑右侧样式即可实时看到效果。')
    ]
  }
}
