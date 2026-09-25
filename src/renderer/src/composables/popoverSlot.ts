import { computed, onScopeDispose, ref, type WritableComputedRef } from 'vue'

/**
 * 全局规则：同一界面内同一时间最多只有一个浮窗打开。
 * 槽位由最后打开的浮窗持有，后来者直接抢占；各浮窗自己的外部点击 / Esc / 滚动关闭策略保持不变。
 */
const holder = ref<string | null>(null)
let seq = 0

export interface PopoverSlot {
  isOpen: WritableComputedRef<boolean>
  /** 抢占槽位并打开（其他浮窗随之关闭） */
  open: () => void
  /** 释放槽位，仅当自身持有时生效 */
  close: () => void
}

export function usePopoverSlot(): PopoverSlot {
  const id = String(++seq)
  const isOpen = computed({
    get: () => holder.value === id,
    set: (v) => (v ? open() : close())
  })

  function open(): void {
    holder.value = id
  }

  function close(): void {
    if (holder.value === id) holder.value = null
  }

  onScopeDispose(close)

  return { isOpen, open, close }
}
