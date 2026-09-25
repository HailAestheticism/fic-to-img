import { onScopeDispose, ref, watch, type Ref } from 'vue'
import { usePopoverSlot } from './popoverSlot'

export interface CardMenu {
  isOpen: Ref<boolean>
  /** 浮层锚点（视口坐标，右对齐按钮、下方 4px） */
  pos: Ref<{ left: number; top: number }>
  /** 传入按钮元素以计算锚点 */
  toggle: (anchor: HTMLElement) => void
  close: () => void
}

export function useCardMenu(): CardMenu {
  const { isOpen, open, close } = usePopoverSlot()
  const pos = ref({ left: 0, top: 0 })

  function toggle(anchor: HTMLElement): void {
    if (isOpen.value) {
      close()
      return
    }
    const r = anchor.getBoundingClientRect()
    pos.value = { left: r.right, top: r.bottom + 4 }
    open()
  }

  /** 菜单打开期间：任意点击、滚动、改变窗口尺寸都收起菜单 */
  function setDismissals(on: boolean): void {
    if (on) {
      window.addEventListener('click', close)
      window.addEventListener('scroll', close, true)
      window.addEventListener('resize', close)
    } else {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }

  watch(isOpen, (v) => setDismissals(v))
  onScopeDispose(() => setDismissals(false))

  return { isOpen, toggle, close, pos }
}
