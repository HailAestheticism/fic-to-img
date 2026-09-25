<script setup lang="ts">
/**
 * 保存预设弹窗：命名 + 类型 + 当前设置总览（只列出该类型会写入的字段）。
 */
import { computed, ref } from 'vue'
import type { Preset } from '@shared/types'
import Modal from '../common/Modal.vue'
import { api } from '../../api'
import { genId } from '../../editor/id'
import { useDocStore } from '../../stores/doc'
import { ANCHORED_FITS, IMAGE_ANCHOR_LABELS, IMAGE_FIT_LABELS, paperLabel } from '@shared/paper'
import { DEFAULT_H0_SCALE } from '@shared/layout'
import { FONT_LABELS } from '../../presets/preset-service'
import { pxToPt, ptToCnName } from '../../editor/format-units'

const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>()
const doc = useDocStore()

const name = ref('')
const kind = ref<'pageSetup' | 'typography' | 'background'>('pageSetup')
const error = ref('')

const KIND_LABELS: Record<'pageSetup' | 'typography' | 'background', string> = {
  pageSetup: '页面设置',
  typography: '文本样式',
  background: '背景'
}

const fontLabel = (f: string): string => FONT_LABELS[f] ?? f

/** 磅值显示为「12pt（小四）」，无名值只显磅 */
function ptText(pt: number): string {
  const v = Math.round(pt * 10) / 10
  const cn = ptToCnName(v)
  return cn ? `${v}pt（${cn}）` : `${v}pt`
}

const layout = computed(() => doc.layout!)
const ps = computed(() => layout.value.pageSetup)
const typo = computed(() => layout.value.typography)

const canvasText = computed(() => {
  const inf = ps.value.infiniteHeight === true
  const land = ps.value.landscape === true
  const fixed = Math.round(ps.value.widthMm)
  const long = Math.round(ps.value.heightMm)
  const size = inf ? `${fixed}×无限 mm` : `${Math.min(fixed, long)}×${Math.max(fixed, long)} mm`
  return `${paperLabel(ps.value.widthMm, ps.value.heightMm, inf)}（${size}${land ? ' · 横向' : ''}）`
})

const marginText = computed(
  () =>
    `上 ${ps.value.marginTopMm} · 下 ${ps.value.marginBottomMm} · 左 ${ps.value.marginLeftMm} · 右 ${ps.value.marginRightMm} mm`
)

const headerText = computed(() =>
  ps.value.header.enabled
    ? `开 · ${ps.value.header.align === 'left' ? '居左' : ps.value.header.align === 'right' ? '居右' : '居中'} · ${ps.value.header.fontSize}pt · ${ps.value.header.text || '（空）'}`
    : '关'
)

const footerText = computed(() => {
  const f = ps.value.footer
  if (!f.enabled) return '关'
  const no = f.showPageNumber ? ` · 页码 ${f.pageNumberFormat || '{page} / {total}'}` : ''
  return `开 · ${f.align === 'left' ? '居左' : f.align === 'right' ? '居右' : '居中'} · ${f.fontSize}pt${no}`
})

const bgText = computed(() => {
  const bg = layout.value.backgrounds.global
  if (!bg) return '无'
  if (bg.kind === 'color') return `纯色 ${bg.color ?? ''}`
  if (bg.kind === 'gradient') return '渐变'
  if (bg.kind === 'texture') return '平铺纹理（旧数据）'
  const fit = bg.imageFit ?? 'fill'
  if (fit === 'multi') {
    const m = bg.multi ?? {}
    return `多图（页首${m.topName ? ` ${m.topName}` : ' 未选'} / 中间${
      m.midKind === 'color' ? ' 纯色' : m.midKind === 'gradient' ? ' 渐变' : m.midName || ' 未选'
    } / 页尾${m.bottomName ? ` ${m.bottomName}` : ' 未选'}）`
  }
  return `图片 ${bg.imageName ?? ''} · ${IMAGE_FIT_LABELS[fit]}${
    ANCHORED_FITS.includes(fit) ? ` · ${IMAGE_ANCHOR_LABELS[bg.imageAnchor ?? 'center']}` : ''
  }`
})

const scaleText = computed(() => {
  const t = typo.value
  const items = [
    ['大标题', t.h0Scale ?? DEFAULT_H0_SCALE],
    ['标题1', t.h1Scale],
    ['标题2', t.h2Scale],
    ['标题3', t.h3Scale],
    ['标题4', t.h4Scale ?? 1.1],
    ['标题5', t.h5Scale ?? 1.05],
    ['标题6', t.h6Scale ?? 1]
  ] as const
  return items.map(([k, v]) => `${k} ${v}`).join(' · ')
})

const rows = computed<{ label: string; value: string }[]>(() => {
  const k = kind.value
  const out: { label: string; value: string }[] = []
  if (k === 'pageSetup') {
    out.push(
      { label: '画布大小', value: canvasText.value },
      { label: '页边距', value: marginText.value },
      { label: '页眉', value: headerText.value },
      { label: '页脚', value: footerText.value }
    )
  }
  if (k === 'typography') {
    out.push(
      { label: '正文字体', value: fontLabel(typo.value.bodyFont) },
      {
        label: '正文字号',
        value: `${typo.value.bodySize}px（${ptText(pxToPt(typo.value.bodySize))}）`
      },
      { label: '行距', value: typo.value.bodyLineHeight },
      { label: '正文颜色', value: typo.value.bodyColor },
      { label: '标题字体', value: fontLabel(typo.value.headingFont) },
      { label: '标题颜色', value: typo.value.headingColor },
      { label: '标题缩放', value: scaleText.value },
      { label: '引用颜色', value: typo.value.quoteColor },
      {
        label: '段前/段后',
        value:
          typo.value.spaceBeforePt || typo.value.spaceAfterPt
            ? `${typo.value.spaceBeforePt ?? '不设'} / ${typo.value.spaceAfterPt ?? '不设'} pt`
            : '不设'
      },
      { label: '首行缩进', value: typo.value.defaultTextIndent || '不设' }
    )
  }
  if (k === 'background') {
    out.push({ label: '全局背景', value: bgText.value })
  }
  return out
})

async function save(): Promise<void> {
  const n = name.value.trim()
  if (!n) {
    error.value = '请先为预设命名'
    return
  }
  error.value = ''
  const k = kind.value
  const data: Preset['data'] = {}
  if (k === 'pageSetup') data.pageSetup = JSON.parse(JSON.stringify(ps.value))
  if (k === 'typography') data.typography = JSON.parse(JSON.stringify(typo.value))
  if (k === 'background') data.background = JSON.parse(JSON.stringify(layout.value.backgrounds.global ?? null))
  await api.presets.save({
    id: genId(),
    name: n,
    kind: k,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data
  })
  emit('saved')
  emit('close')
}
</script>

<template>
  <Modal title="保存为预设" wide @close="emit('close')">
    <div class="psd-form">
      <label class="psd-field">
        <span>名称</span>
        <input v-model="name" class="input" placeholder="预设名称（必填）" />
      </label>
      <label class="psd-field">
        <span>类型</span>
        <select v-model="kind" class="input">
          <option value="pageSetup">页面设置</option>
          <option value="typography">文本样式</option>
          <option value="background">背景</option>
        </select>
      </label>
    </div>
    <p v-if="error" class="psd-error">{{ error }}</p>

    <h4 class="psd-sub">{{ KIND_LABELS[kind] }}总览</h4>
    <dl class="psd-rows">
      <template v-for="r in rows" :key="r.label">
        <dt>{{ r.label }}</dt>
        <dd>{{ r.value }}</dd>
      </template>
    </dl>
    <p class="psd-hint">总览取自当前文档设置，保存后跨文档可用。</p>

    <template #footer>
      <button class="btn" @click="emit('close')">取消</button>
      <button class="btn primary" @click="save">保存预设</button>
    </template>
  </Modal>
</template>

<style scoped>
.psd-form {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.psd-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--ink-soft);
}

.psd-field .input {
  min-width: 180px;
}

.psd-sub {
  margin: 14px 0 6px;
  font-size: 13px;
  color: var(--ink);
}

.psd-rows {
  margin: 0;
  display: grid;
  grid-template-columns: 84px 1fr;
  gap: 4px 10px;
  font-size: 12px;
}

.psd-rows dt {
  color: var(--muted);
}

.psd-rows dd {
  margin: 0;
  color: var(--ink);
  word-break: break-all;
}

.psd-hint,
.psd-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--muted);
}

.psd-error {
  color: var(--danger, #b3402f);
}
</style>
