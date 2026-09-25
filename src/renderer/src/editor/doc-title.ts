import { Node } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { Transaction } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docTitle: {
      /** 把首块设为 H0（仅当光标位于文档第一块） */
      setDocTitle: () => ReturnType
    }
  }
}

/** 光标所在顶层块是否为文档首块 */
function cursorInFirstBlock(editor: Editor): boolean {
  const { $from } = editor.state.selection
  return $from.depth === 1 && $from.index(0) === 0
}

export function isDocTitle(node: PMNode | null | undefined): boolean {
  return !!node && node.type.name === 'docTitle'
}

/**
 * H0 文档标题块：只允许作为文档第一个块存在一个。
 * 空 H0 按 Enter 退化为正文；非空 H0 按 Enter 在光标处拆出正文段落。
 */
export const DocTitle = Node.create({
  name: 'docTitle',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'h0' }]
  },

  renderHTML() {
    return ['h0', { class: 'doc-title' }, 0]
  },

  addCommands() {
    return {
      setDocTitle:
        () =>
        ({ state, dispatch, tr, editor }) => {
          if (!editor || !cursorInFirstBlock(editor)) return false
          const first = state.doc.child(0)
          if (first.type.name === 'docTitle') return true
          if (dispatch) dispatch(tr.setNodeMarkup(0, state.schema.nodes.docTitle))
          return true
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { selection } = state
        if (!selection.empty) return false
        if (!cursorInFirstBlock(editor)) return false
        const first = state.doc.child(0)
        if (first.type.name !== 'docTitle') return false
        const $from = selection.$from
        const tr = state.tr
        if (!first.textContent.length) {
          tr.setNodeMarkup(0, state.schema.nodes.paragraph)
        } else {
          const end = $from.end(1)
          const rest = $from.pos < end ? state.doc.slice($from.pos, end).content : null
          const reuse =
            !rest &&
            state.doc.childCount > 1 &&
            state.doc.child(1).type.name === 'paragraph' &&
            !state.doc.child(1).textContent.length
          if (reuse) {
            // 已有空正文段落（如 TrailingNode 补的）时直接落位，避免出现两个空行
            tr.setSelection(TextSelection.near(state.doc.resolve(1 + first.nodeSize), 1))
          } else {
            tr.delete($from.pos, end)
            const insertPos = 1 + tr.doc.child(0).nodeSize
            const para = state.schema.nodes.paragraph.create(null, rest ?? undefined)
            tr.insert(insertPos, para)
            tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos), 1))
          }
        }
        tr.scrollIntoView()
        editor.view.dispatch(tr)
        return true
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction: (trs, _old, state) => {
          if (!trs.some((t) => t.docChanged)) return null
          const para = state.schema.nodes.paragraph
          let seen = false
          let tr: Transaction | null = null
          state.doc.forEach((node, offset) => {
            if (node.type.name !== 'docTitle') return
            if (!seen && offset === 0) {
              seen = true
              return
            }
            tr = (tr ?? state.tr).setNodeMarkup(offset, para, null)
          })
          return tr
        }
      })
    ]
  }
})
