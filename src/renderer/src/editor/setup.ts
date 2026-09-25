import { Extension } from '@tiptap/core'
import type { Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { TextStyle } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { ChapterBreak, ChapterMarker } from './chapter-break'
import { DocTitle } from './doc-title'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    richStyle: {
      setColor: (color: string | null) => ReturnType
      setBgColor: (color: string | null) => ReturnType
      setFontFamily: (family: string | null) => ReturnType
      setFontSize: (size: string | null) => ReturnType
      setTextAlign: (align: string | null) => ReturnType
    }
  }
}

function markStyleAttr(attr: string, css: string) {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) =>
      (element.style as unknown as Record<string, string>)[css] || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[attr] ? { style: `${css}: ${String(attributes[attr])}` } : {}
  }
}

/**
 * 块级样式属性。camel/dashed 是同一 CSS 属性的两种写法：
 * parseHTML 读 element.style 用驼峰键，renderHTML 写内联 style 用连字符值。
 * 段间距/缩进用逻辑属性（margin-block-start 等），竖排换轴时自动落到列推进方向；
 * legacy 是旧文档里的物理内联样式键（如 marginTop），只读不写。
 */
function blockStyleAttr(attr: string, camel: string, dashed: string, legacy = '') {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => {
      const st = element.style as unknown as Record<string, string>
      return st[camel] || (legacy ? st[legacy] : '') || null
    },
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes[attr] ? { style: `${dashed}: ${String(attributes[attr])}` } : {}
  }
}

/** 行内文字颜色 / 填充（背景）颜色 */
const ColorStyle = Extension.create({
  name: 'colorStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          color: markStyleAttr('color', 'color'),
          backgroundColor: markStyleAttr('backgroundColor', 'background-color')
        }
      }
    ]
  },
  addCommands() {
    return {
      setColor:
        (color) =>
        ({ chain }) =>
          chain().setMark('textStyle', { color }).run(),
      setBgColor:
        (color) =>
        ({ chain }) =>
          chain().setMark('textStyle', { backgroundColor: color }).run()
    }
  }
})

/** 行内字体 */
const FontFamilyStyle = Extension.create({
  name: 'fontFamilyStyle',
  addGlobalAttributes() {
    return [
      { types: ['textStyle'], attributes: { fontFamily: markStyleAttr('fontFamily', 'font-family') } }
    ]
  },
  addCommands() {
    return {
      setFontFamily:
        (family) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontFamily: family }).run()
    }
  }
})

/** 行内字号 */
const FontSizeStyle = Extension.create({
  name: 'fontSizeStyle',
  addGlobalAttributes() {
    return [
      { types: ['textStyle'], attributes: { fontSize: markStyleAttr('fontSize', 'font-size') } }
    ]
  },
  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run()
    }
  }
})

/** 段落/标题对齐 */
const AlignStyle = Extension.create({
  name: 'alignStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: { textAlign: blockStyleAttr('textAlign', 'textAlign', 'text-align') }
      }
    ]
  },
  addCommands() {
    return {
      setTextAlign:
        (align) =>
        ({ chain }) =>
          chain()
            .updateAttributes('paragraph', { textAlign: align })
            .updateAttributes('heading', { textAlign: align })
            .run()
    }
  }
})

/** 段落/标题行距、缩进与段间距 */
const ParagraphStyle = Extension.create({
  name: 'paragraphStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineHeight: blockStyleAttr('lineHeight', 'lineHeight', 'line-height'),
          textIndent: blockStyleAttr('textIndent', 'textIndent', 'text-indent'),
          indentLeft: blockStyleAttr(
            'indentLeft',
            'marginInlineStart',
            'margin-inline-start',
            'marginLeft'
          ),
          indentRight: blockStyleAttr(
            'indentRight',
            'marginInlineEnd',
            'margin-inline-end',
            'marginRight'
          ),
          spaceBefore: blockStyleAttr(
            'spaceBefore',
            'marginBlockStart',
            'margin-block-start',
            'marginTop'
          ),
          spaceAfter: blockStyleAttr(
            'spaceAfter',
            'marginBlockEnd',
            'margin-block-end',
            'marginBottom'
          )
        }
      }
    ]
  }
})

/**
 * 竖向排列不再逐块设置：画布横向（pageSetup.landscape）= 全文档竖排，
 * 由 .vert-flow 容器样式驱动（见 global.css 与 pager/paginate.ts）。
 */

/**
 * 组装编辑器扩展。
 *
 * @param opts.history 是否启用 ProseMirror 自带的正文撤销栈。
 *   写作界面沿用（能保住光标）；排版/混合界面的分页视图必须传 false——
 *   那两处由 doc store 的统一时间线负责撤销，留着会出现「按一次撤销两步」。
 */
export function buildExtensions(opts: { history?: boolean } = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      code: false,
      codeBlock: false,
      link: { openOnClick: false },
      undoRedo: opts.history === false ? false : {}
    }),
    TextStyle,
    ColorStyle,
    FontFamilyStyle,
    FontSizeStyle,
    AlignStyle,
    ParagraphStyle,
    Image.configure({ inline: false, allowBase64: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableCell,
    TableHeader,
    ChapterBreak,
    ChapterMarker,
    DocTitle,
    Placeholder.configure({ placeholder: '开始写作…' })
  ]
}
