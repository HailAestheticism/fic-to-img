import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { SplitRules } from '@shared/types'
import { genId } from './id'

export interface ChapterItem {
  chapterId: string
  title: string
  /** 该章起始块在文档中的 PM 位置 */
  pos: number
  kind: 'pre' | 'break' | 'heading'
}

function headingMatches(node: PMNode, rules: SplitRules): boolean {
  if (node.type.name !== 'heading') return false
  if (rules.h1 && node.attrs.level === 1) return true
  if (rules.regex && rules.pattern) {
    try {
      if (new RegExp(rules.pattern).test(node.textContent)) return true
    } catch {
      /* 非法正则按未命中处理 */
    }
  }
  return false
}

/** 从文档派生章节列表：序章（首块之前的内容）+ 章节符 + 命中规则的标题 */
export function chaptersOf(doc: PMNode, rules: SplitRules, docTitle: string): ChapterItem[] {
  const chapters: ChapterItem[] = []
  doc.forEach((child, offset) => {
    if (child.type.name === 'chapterBreak') {
      chapters.push({
        chapterId: String(child.attrs.chapterId ?? genId()),
        title: String(child.attrs.title || '未命名章节'),
        pos: offset,
        kind: 'break'
      })
    } else if (headingMatches(child, rules)) {
      chapters.push({
        chapterId: String(child.attrs.chapterId ?? ''),
        title: child.textContent || '未命名章节',
        pos: offset,
        kind: 'heading'
      })
    }
  })

  if (!chapters.length) {
    return [{ chapterId: '__doc', title: docTitle || '全文', pos: 0, kind: 'pre' }]
  }
  if (chapters[0].pos > 0) {
    chapters.unshift({ chapterId: '__pre', title: '序章', pos: 0, kind: 'pre' })
  }
  return chapters
}

/**
 * 为命中分割规则但没有 chapterId 的标题分配稳定 ID（写入文档，随后持久化）。
 * 只在有缺失时派发事务，不会循环触发。
 */
export function ensureChapterIds(editor: Editor, rules: SplitRules): boolean {
  const { doc } = editor.state
  const tr = editor.state.tr
  let changed = false
  doc.forEach((child, offset) => {
    if (headingMatches(child, rules) && !child.attrs.chapterId) {
      tr.setNodeMarkup(offset, undefined, { ...child.attrs, chapterId: genId() })
      changed = true
    }
  })
  if (changed) editor.view.dispatch(tr)
  return changed
}

/** 跳转到某章起始位置并把光标滚动到可视区 */
export function jumpToPos(editor: Editor, pos: number): void {
  const clamped = Math.max(0, Math.min(pos + 1, editor.state.doc.content.size - 1))
  const $pos = editor.state.doc.resolve(clamped)
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.near($pos)).scrollIntoView()
  )
  editor.view.focus()
}
