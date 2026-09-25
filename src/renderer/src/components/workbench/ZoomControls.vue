<script setup lang="ts">
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_BTN, useZoom } from '../../composables/zoom'

/** 界面缩放控件：右下角悬浮一贴，缩小键 / 当前比例 / 放大键；点比例数字回 100% */
const { percent, stepZoom, resetZoom } = useZoom()
</script>

<template>
  <div class="zoom-dock" title="Ctrl+滚轮上下缩放；切换画布横向或更换画布尺寸后回到 100%">
    <button
      class="z-btn"
      :disabled="percent <= ZOOM_MIN"
      title="缩小 (Ctrl+滚轮下)"
      @click="stepZoom(-ZOOM_STEP_BTN)"
    >
      &minus;
    </button>
    <button
      class="z-pct"
      :style="{ minWidth: `${String(percent).length + 2}ch` }"
      title="点击恢复 100%"
      @click="resetZoom"
    >
      {{ percent }}%
    </button>
    <button
      class="z-btn"
      :disabled="percent >= ZOOM_MAX"
      title="放大 (Ctrl+滚轮上)"
      @click="stepZoom(ZOOM_STEP_BTN)"
    >
      &#43;
    </button>
  </div>
</template>

<style scoped>
.zoom-dock {
  position: absolute;
  bottom: 18px;
  right: 18px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel);
  box-shadow: var(--shadow);
  user-select: none;
}

.z-btn,
.z-pct {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 24px;
  min-width: 24px;
  padding: 0 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}

.z-pct {
  font-variant-numeric: tabular-nums;
}

.z-btn:hover:not(:disabled),
.z-pct:hover {
  background: var(--accent-soft, rgb(138 109 59 / 12%));
  color: var(--accent);
}

.z-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
