import { computed, reactive } from 'vue'

/**
 * 界面缩放（阶段 24）：**仅存活于本次运行，刻意不持久化**——
 * 每次启动软件所有文档所有界面都回到默认 100%；运行中四个界面（写作/排版/混合/预览）
 * 共用同一份最新设置。100% 的基准 = 各画布尺寸保持竖向时的默认显示大小
 * （分页视图即 PagedView 的自适应 fit 比例，写作界面即无缩放现状）。
 * 规则 3：切换画布横向 / 解除横向 / 更换画布尺寸时由 WorkbenchView 调 resetZoom()。
 */
export const ZOOM_MIN = 25
export const ZOOM_MAX = 400
/** 放大/缩小键一档 10%，Ctrl+滚轮一格 5% */
export const ZOOM_STEP_BTN = 10
export const ZOOM_STEP_WHEEL = 5

const state = reactive({ percent: 100 })

function clamp(p: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(p / 5) * 5))
}

const percent = computed(() => state.percent)
const factor = computed(() => state.percent / 100)

function setZoom(p: number): void {
  state.percent = clamp(p)
}

function stepZoom(d: number): void {
  setZoom(state.percent + d)
}

function resetZoom(): void {
  state.percent = 100
}

export function useZoom(): {
  percent: typeof percent
  factor: typeof factor
  setZoom: typeof setZoom
  stepZoom: typeof stepZoom
  resetZoom: typeof resetZoom
} {
  return { percent, factor, setZoom, stepZoom, resetZoom }
}
