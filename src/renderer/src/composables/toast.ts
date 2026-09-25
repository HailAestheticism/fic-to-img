import { reactive } from 'vue'

interface ToastItem {
  id: number
  text: string
}

const items = reactive<ToastItem[]>([])
let seq = 0

/** 轻量全局提示（被动通知，不占浮窗互斥槽位） */
export function showToast(text: string): void {
  const id = ++seq
  items.push({ id, text })
  setTimeout(() => {
    const i = items.findIndex((t) => t.id === id)
    if (i >= 0) items.splice(i, 1)
  }, 4200)
}

export function useToasts(): ToastItem[] {
  return items
}
