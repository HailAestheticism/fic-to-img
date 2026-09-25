<script setup lang="ts">
import type { ImageFit } from '@shared/types'

/**
 * 图片填充模式示意小图。虚线框 = 画布（32×24 viewBox），实心块 = 图片。
 * 充满模式把图片画成溢出画布并被裁切，以区别于「拉伸」。
 */
defineProps<{ fit: ImageFit }>()
</script>

<template>
  <svg class="bfi" viewBox="0 0 32 24" aria-hidden="true">
    <defs>
      <clipPath id="bgfit-canvas">
        <rect x="1.5" y="1.5" width="29" height="21" />
      </clipPath>
    </defs>
    <g clip-path="url(#bgfit-canvas)">
      <template v-if="fit === 'fill'">
        <rect class="bfi-img" x="1.5" y="-8" width="29" height="40" />
      </template>
      <template v-else-if="fit === 'stretch'">
        <rect class="bfi-img" x="1.5" y="1.5" width="29" height="21" />
        <line class="bfi-cross" x1="1.5" y1="1.5" x2="30.5" y2="22.5" />
        <line class="bfi-cross" x1="30.5" y1="1.5" x2="1.5" y2="22.5" />
      </template>
      <template v-else-if="fit === 'tile'">
        <rect class="bfi-img" x="1.5" y="1.5" width="9.6" height="7" />
        <rect class="bfi-img" x="11.7" y="1.5" width="9.6" height="7" />
        <rect class="bfi-img" x="21.9" y="1.5" width="9.6" height="7" />
        <rect class="bfi-img" x="1.5" y="9.5" width="9.6" height="7" />
        <rect class="bfi-img" x="11.7" y="9.5" width="9.6" height="7" />
        <rect class="bfi-img" x="21.9" y="9.5" width="9.6" height="7" />
        <rect class="bfi-img" x="1.5" y="17.5" width="9.6" height="7" />
        <rect class="bfi-img" x="11.7" y="17.5" width="9.6" height="7" />
        <rect class="bfi-img" x="21.9" y="17.5" width="9.6" height="7" />
      </template>
      <template v-else-if="fit === 'offset-tile'">
        <rect class="bfi-img" x="1.5" y="1.5" width="9.6" height="7" />
        <rect class="bfi-img" x="1.5" y="9.5" width="9.6" height="7" />
        <rect class="bfi-img" x="1.5" y="17.5" width="9.6" height="7" />
        <rect class="bfi-img" x="21.9" y="1.5" width="9.6" height="7" />
        <rect class="bfi-img" x="21.9" y="9.5" width="9.6" height="7" />
        <rect class="bfi-img" x="21.9" y="17.5" width="9.6" height="7" />
        <rect class="bfi-img bfi-off" x="11.7" y="5" width="9.6" height="7" />
        <rect class="bfi-img bfi-off" x="11.7" y="13" width="9.6" height="7" />
        <rect class="bfi-img bfi-off" x="11.7" y="-2" width="9.6" height="7" />
      </template>
      <template v-else>
        <rect class="bfi-img" x="1.5" y="1.5" width="29" height="6" />
        <rect class="bfi-img" x="1.5" y="16.5" width="29" height="6" />
        <line class="bfi-cross" x1="4" y1="12" x2="28" y2="12" />
        <line class="bfi-cross" x1="4" y1="10" x2="28" y2="10" />
        <line class="bfi-cross" x1="4" y1="14" x2="28" y2="14" />
      </template>
    </g>
    <rect class="bfi-canvas" x="1.5" y="1.5" width="29" height="21" rx="1" />
  </svg>
</template>

<style scoped>
.bfi {
  width: 32px;
  height: 24px;
  flex-shrink: 0;
}

.bfi-canvas {
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  stroke-dasharray: 2 2;
  opacity: 0.8;
}

.bfi-img {
  fill: currentColor;
  opacity: 0.32;
  stroke: currentColor;
  stroke-width: 0.8;
}

.bfi-off {
  opacity: 0.55;
}

.bfi-cross {
  stroke: currentColor;
  stroke-width: 0.8;
  opacity: 0.85;
}
</style>
