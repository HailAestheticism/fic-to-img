<script setup lang="ts">
import { computed } from 'vue'
import type { DocCardInfo } from '@shared/types'
import {
  ANCHORED_FITS,
  IMAGE_ANCHOR_LABELS,
  IMAGE_FIT_LABELS,
  paperLabel,
  sizeCategory,
  SIZE_CATEGORY_LABELS
} from '@shared/paper'
import { fontLabel } from '../../presets/font-store'
import GlyphIcon from '../common/GlyphIcon.vue'

const props = defineProps<{ card: DocCardInfo }>()

const bg = computed(() => props.card.background)
const category = computed(() => sizeCategory(props.card.widthMm, props.card.heightMm, props.card.infiniteHeight))

const bgSummary = computed(() => {
  const b = bg.value
  if (!b) return '无（跟随界面）'
  switch (b.kind) {
    case 'color':
      return b.color || '未设置'
    case 'gradient':
      return '渐变填充'
    case 'texture':
      return '纹理平铺（旧数据）'
    case 'image': {
      const fit = b.imageFit ?? 'fill'
      const fitText = IMAGE_FIT_LABELS[fit]
      if (fit === 'multi') {
        const m = b.multi ?? {}
        const mid =
          m.midKind === 'color' ? '纯色' : m.midKind === 'gradient' ? '渐变' : m.midName || '未选'
        return `多图 · 页首${m.topName ? '有' : '无'} / 中间${mid} / 页尾${m.bottomName ? '有' : '无'}`
      }
      const name = b.imageName ? ` ${b.imageName}` : ''
      return `图片${name} · ${fitText}${ANCHORED_FITS.includes(fit) ? ` · ${IMAGE_ANCHOR_LABELS[b.imageAnchor ?? 'center']}` : ''}`
    }
    default:
      return '未知'
  }
})

const bgSwatchStyle = computed<Record<string, string | undefined>>(() => {
  const b = bg.value
  if (!b) return { background: 'var(--panel-soft)' }
  if (b.kind === 'color') return { background: b.color || '#fff' }
  if (b.kind === 'gradient') return { background: b.gradient || '#fff' }
  if (b.kind === 'texture' && b.textureUrl)
    return { backgroundImage: `url("${b.textureUrl}")`, backgroundRepeat: 'repeat' }
  if (b.kind === 'image') {
    const fit = b.imageFit ?? 'fill'
    const url = fit === 'multi' ? (b.multi?.topUrl ?? b.multi?.midUrl ?? b.multi?.bottomUrl) : b.imageUrl
    if (!url) return { background: '#fff' }
    if (fit === 'stretch' || fit === 'multi')
      return { backgroundImage: `url("${url}")`, backgroundSize: '100% 100%' }
    if (fit === 'tile' || fit === 'offset-tile')
      return { backgroundImage: `url("${url}")`, backgroundRepeat: 'repeat' }
    return { backgroundImage: `url("${url}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  return { background: '#fff' }
})

function fmtFull(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtChars(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)} 万字` : `${n} 字`
}
</script>

<template>
  <div class="doc-detail">
    <h4 class="dd-title" :title="card.meta.title">{{ card.meta.title }}</h4>
    <dl class="dd-list">
      <dt>文件夹</dt>
      <dd>{{ card.meta.folder || '未归类' }}</dd>
      <dt>建立时间</dt>
      <dd>{{ fmtFull(card.meta.createdAt) }}</dd>
      <dt>最后编辑</dt>
      <dd>{{ fmtFull(card.meta.updatedAt) }}</dd>
      <dt>字数</dt>
      <dd>{{ fmtChars(card.charCount) }}</dd>
      <dt v-if="card.meta.tags.length">标签</dt>
      <dd v-if="card.meta.tags.length">{{ card.meta.tags.join('、') }}</dd>
    </dl>

    <h5 class="dd-sec">尺寸</h5>
    <div class="dd-row">
      <span class="dd-icon dd-swatch-badge">
        <GlyphIcon :name="category" :size="14" />
      </span>
      <span>{{ SIZE_CATEGORY_LABELS[category] }} · {{ paperLabel(card.widthMm, card.heightMm, card.infiniteHeight) }}（{{ Math.round(card.widthMm) }}×{{ card.infiniteHeight ? '无限' : Math.round(card.heightMm) }} mm{{ card.landscape ? ' · 横向' : '' }}）</span>
    </div>
    <dl class="dd-list">
      <dt>页边距</dt>
      <dd>上 {{ card.marginsMm.top }} · 右 {{ card.marginsMm.right }} · 下 {{ card.marginsMm.bottom }} · 左 {{ card.marginsMm.left }} mm</dd>
    </dl>

    <h5 class="dd-sec">样式</h5>
    <div class="dd-row">
      <span class="dd-icon dd-swatch" :style="bgSwatchStyle" />
      <span>背景：{{ bgSummary }}</span>
    </div>
    <dl class="dd-list dd-style">
      <dt>正文</dt>
      <dd>
        <span class="dd-font" :style="{ fontFamily: card.bodyFont || undefined, color: card.bodyColor }">Aa {{ fontLabel(card.bodyFont) }} · {{ card.bodySize }}px</span>
        <span class="muted">行距 {{ card.bodyLineHeight }}</span>
      </dd>
      <dt>一级标题</dt>
      <dd><span class="dd-font" :style="{ fontFamily: card.headingFont || undefined, color: card.headingColor }">Aa {{ card.h1Size }}px</span></dd>
      <dt>二级标题</dt>
      <dd><span class="dd-font" :style="{ fontFamily: card.headingFont || undefined, color: card.headingColor }">Aa {{ card.h2Size }}px</span></dd>
      <dt>三级标题</dt>
      <dd><span class="dd-font" :style="{ fontFamily: card.headingFont || undefined, color: card.headingColor }">Aa {{ card.h3Size }}px</span></dd>
      <dt>引用色</dt>
      <dd><span class="dd-chip" :style="{ background: card.quoteColor }" /> {{ card.quoteColor }}</dd>
    </dl>
  </div>
</template>

<style scoped>
.doc-detail {
  font-size: 13px;
  color: var(--ink);
  line-height: 1.6;
}

.dd-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 10px;
  word-break: break-word;
}

.dd-sec {
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
  margin: 14px 0 6px;
  letter-spacing: 1px;
}

.dd-list {
  display: grid;
  grid-template-columns: 76px 1fr;
  gap: 4px 10px;
  margin: 0;
}

.dd-list dt {
  color: var(--muted);
  font-size: 12px;
}

.dd-list dd {
  margin: 0;
  word-break: break-word;
}

.dd-style dt {
  padding-top: 2px;
}

.dd-font {
  display: inline-block;
  margin-right: 8px;
}

.dd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 8px;
}

.dd-icon {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--ink-soft);
  background: var(--bg);
}

.dd-swatch {
  border-radius: 6px;
  background-color: #fff;
}

.dd-chip {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  border: 1px solid var(--border-strong);
  vertical-align: -2px;
  margin-right: 4px;
}
</style>
