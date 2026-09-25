import { onBeforeUnmount, onMounted } from 'vue'
import type { WorkbenchMode } from '@shared/types'
import { useAppStore } from '../stores/app'
import { useDocStore } from '../stores/doc'

const MODE_BY_KEY: Record<string, WorkbenchMode> = {
  '1': 'write',
  '2': 'layout',
  '3': 'mixed',
  '4': 'preview'
}

/** 输入框（非正文编辑器）里的 Ctrl+Z 交回浏览器原生撤销 */
function inFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target.isContentEditable && !target.closest('.tiptap-prose'))
  )
}

/** 写作界面的正文编辑器保留 ProseMirror 自带撤销（能精确还原光标位置） */
function inWriteEditor(target: EventTarget | null, mode: string): boolean {
  return mode === 'write' && target instanceof HTMLElement && !!target.closest('.tiptap-prose')
}

export function useWorkbenchShortcuts(handlers: { onSnapshot: () => void }): void {
  const app = useAppStore()
  const doc = useDocStore()

  async function onKeydown(e: KeyboardEvent): Promise<void> {
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()

    if (key === 's' && !e.shiftKey) {
      e.preventDefault()
      await doc.flush()
      return
    }
    if (key === 's' && e.shiftKey) {
      e.preventDefault()
      handlers.onSnapshot()
      return
    }
    if (key === 'p') {
      e.preventDefault()
      app.mode = 'preview'
      return
    }
    if (MODE_BY_KEY[e.key] && !e.shiftKey) {
      e.preventDefault()
      app.mode = MODE_BY_KEY[e.key]
      return
    }
    if (key === 'z' || key === 'y') {
      // 预览界面纯只读，禁用撤销/重做
      if (app.mode === 'preview') return
      if (inFormField(e.target) || inWriteEditor(e.target, app.mode)) return
      const redo = key === 'y' || e.shiftKey
      e.preventDefault()
      // 正文与画布共用一条时间线，不再按当前图层分流
      if (redo) doc.redo()
      else doc.undo()
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
