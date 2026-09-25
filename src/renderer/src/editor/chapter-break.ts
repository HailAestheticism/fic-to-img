import { Node, Extension } from '@tiptap/core'
import type { NodeViewRendererProps } from '@tiptap/core'
import { genId } from './id'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chapter: {
      insertChapterBreak: () => ReturnType
    }
  }
}

/**
 * 手动分章节符：原子块节点，标题通过节点内嵌输入框编辑，
 * chapterId 在插入时生成并随文档 JSON 持久化。
 */
export const ChapterBreak = Node.create({
  name: 'chapterBreak',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      chapterId: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute('data-chapter-id'),
        renderHTML: (attributes) =>
          attributes.chapterId ? { 'data-chapter-id': attributes.chapterId } : {}
      },
      title: {
        default: '未命名章节',
        parseHTML: (element) => element.getAttribute('data-title') ?? '未命名章节',
        renderHTML: (attributes) => ({ 'data-title': attributes.title })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-chapter-break]' }]
  },

  renderHTML({ node }) {
    return [
      'div',
      { 'data-chapter-break': '', class: 'chapter-break' },
      ['span', { class: 'chapter-break-label' }, String(node.attrs.title ?? '未命名章节')]
    ]
  },

  addNodeView() {
    return ({ node, editor, getPos }: NodeViewRendererProps) => {
      const dom = document.createElement('div')
      dom.className = 'chapter-break'
      dom.setAttribute('data-chapter-break', '')
      if (node.attrs.chapterId) dom.setAttribute('data-chapter-id', node.attrs.chapterId)

      const label = document.createElement('span')
      label.className = 'chapter-break-label'
      label.textContent = String(node.attrs.title ?? '未命名章节')

      const rename = document.createElement('button')
      rename.className = 'chapter-break-rename'
      rename.textContent = '重命名'
      rename.setAttribute('contenteditable', 'false')

      const commit = (input: HTMLInputElement): void => {
        const title = input.value.trim() || '未命名章节'
        if (typeof getPos === 'function') {
          const pos = getPos()
          if (pos != null) {
            editor.view.dispatch(
              editor.view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, title })
            )
          }
        }
        label.textContent = title
        dom.replaceChild(label, input)
      }

      rename.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const input = document.createElement('input')
        input.className = 'chapter-break-input'
        input.setAttribute('contenteditable', 'false')
        input.value = String(node.attrs.title ?? '')
        dom.replaceChild(input, label)
        input.focus()
        input.select()
        input.addEventListener('blur', () => commit(input))
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') input.blur()
          if (ke.key === 'Escape') {
            input.removeEventListener('blur', () => commit(input))
            dom.replaceChild(label, input)
          }
        })
      })

      dom.appendChild(label)
      dom.appendChild(rename)

      return {
        dom,
        stopEvent: (event) => {
          const target = event.target as HTMLElement | null
          return !!target?.closest('button, input')
        },
        ignoreMutation: () => true
      }
    }
  },

  addCommands() {
    return {
      insertChapterBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({
              type: 'chapterBreak',
              attrs: { chapterId: genId(), title: '新章节' }
            })
            .run()
    }
  }
})

/** 给标题节点挂 chapterId 属性（自动分章时写入并随文档持久化） */
export const ChapterMarker = Extension.create({
  name: 'chapterMarker',
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          chapterId: {
            default: null as string | null,
            parseHTML: (element) => element.getAttribute('data-chapter-id'),
            renderHTML: (attributes) =>
              attributes.chapterId ? { 'data-chapter-id': attributes.chapterId } : {}
          }
        }
      }
    ]
  }
})
