<script setup lang="ts">
/**
 * 预设卡片：背景预览 + 四级文字样式样例（H0 文档标题 / 一级标题 / 二级标题 / 正文两段），
 * 字体、字号、行距、段间距、首行缩进全部按预设的排版令牌呈现。无右上角菜单键。
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { Preset, Typography } from '@shared/types'
import { defaultTypography, h0ScaleOf } from '@shared/layout'
import { applyBackgroundSpec } from '../../pager/background-render'
import { KIND_LABELS } from '../../presets/preset-view'

const props = defineProps<{ preset: Preset }>()
const emit = defineEmits<{ (e: 'open'): void }>()

const previewEl = ref<HTMLElement | null>(null)
const typo = computed(() => props.preset.data.typography ?? defaultTypography())

/** 与文档卡一致的缩比：真实字号 × 0.62 */
const SCALE = 0.62

function previewSize(size: number, cap: number): number {
  return Math.max(11, Math.min(cap, Math.round(size * SCALE)))
}

/** 段间距：预设给 pt 则按缩比写 pt，未给值时由 scoped CSS 的 em 默认值兜底 */
function spacingPt(pt: number | undefined): string | undefined {
  return pt === undefined ? undefined : `${Math.round(pt * SCALE)}pt`
}

function headingStyle(scale: number, cap: number, lineHeight: number) {
  const t = typo.value
  return {
    fontFamily: `"${t.headingFont}"`,
    color: t.headingColor,
    fontSize: `${previewSize(t.bodySize * scale, cap)}px`,
    fontWeight: 700,
    lineHeight
  }
}

/** H0 = 文档标题（预设名即其文本），与文档卡片同一规则 */
const h0Style = computed(() => headingStyle(h0ScaleOf(typo.value), 30, 1.35))
const h1Style = computed(() => headingStyle(typo.value.h1Scale, 24, 1.4))
const h2Style = computed(() => headingStyle(typo.value.h2Scale, 20, 1.4))

function bodyStyle(first: boolean) {
  const t: Typography = typo.value
  return {
    fontFamily: `"${t.bodyFont}"`,
    color: t.bodyColor,
    fontSize: `${previewSize(t.bodySize, 17)}px`,
    lineHeight: t.bodyLineHeight,
    textIndent: t.defaultTextIndent || undefined,
    marginTop: first ? '0px' : spacingPt(t.spaceBeforePt),
    marginBottom: spacingPt(t.spaceAfterPt) ?? '0px'
  }
}

const body1Style = computed(() => bodyStyle(true))
const body2Style = computed(() => bodyStyle(false))

function paintBg(): void {
  if (previewEl.value) void applyBackgroundSpec(previewEl.value, props.preset.data.background)
}

onMounted(paintBg)
watch(() => JSON.stringify(props.preset.data.background), paintBg)
</script>

<template>
  <article class="preset-tile" @click="emit('open')">
    <div ref="previewEl" class="pt-preview">
      <p class="pt-h0" :style="h0Style" :title="props.preset.name">
        {{ props.preset.name || '未命名预设' }}
      </p>
      <p class="pt-h1" :style="h1Style">一级标题</p>
      <p class="pt-h2" :style="h2Style">二级标题</p>
      <p class="pt-body" :style="body1Style">正文样式示例，字体、字号与行距都按本预设呈现。</p>
      <p class="pt-body" :style="body2Style">第二段与上一段之间的空白即预设的段间距。</p>
    </div>
    <footer class="pt-foot">
      <span class="pt-kind">{{ KIND_LABELS[props.preset.kind] }}</span>
    </footer>
  </article>
</template>

<style scoped>
.preset-tile {
  display: flex;
  flex-direction: column;
  height: var(--tile-h, 266px);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  background: var(--panel);
  transition: box-shadow 0.15s, transform 0.15s, border-color 0.15s;
  user-select: none;
}

.preset-tile:hover {
  border-color: var(--accent);
  box-shadow: var(--shadow);
  transform: translateY(-2px);
}

.pt-preview {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 10px 14px;
}

/* 字号由内联样式给，间距一律用 em —— 与 .tiptap-prose 同源，随缩比后的字号等比缩放 */
.pt-h0 {
  margin: 0;
  font-weight: 700;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pt-h1,
.pt-h2 {
  margin: 1.4em 0 0;
  font-weight: 700;
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pt-body {
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 预设未设段间距时的兜底，与 .tiptap-prose p:not(:first-child) 的 0.8em 一致 */
.pt-body + .pt-body {
  margin-top: 0.8em;
}

.pt-foot {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-top: 1px solid var(--border);
  background: var(--panel);
}

.pt-kind {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--muted);
}
</style>
