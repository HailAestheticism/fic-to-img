<script setup lang="ts">
/**
 * 文档默认排版（Typography）表单：正文 / 标题两段全部令牌。
 * 直接改传入的响应式对象，宿主负责落库。
 */
import type { Typography } from '@shared/types'
import { DEFAULT_H0_SCALE } from '@shared/layout'
import FontSelect from '../common/FontSelect.vue'

const props = defineProps<{ typo: Typography }>()

const scaleFields: {
  key: 'h0Scale' | 'h1Scale' | 'h2Scale' | 'h3Scale' | 'h4Scale' | 'h5Scale' | 'h6Scale'
  label: string
  fallback: number
}[] = [
  { key: 'h0Scale', label: '大标题', fallback: DEFAULT_H0_SCALE },
  { key: 'h1Scale', label: '标题1', fallback: 1.7 },
  { key: 'h2Scale', label: '标题2', fallback: 1.4 },
  { key: 'h3Scale', label: '标题3', fallback: 1.2 },
  { key: 'h4Scale', label: '标题4', fallback: 1.1 },
  { key: 'h5Scale', label: '标题5', fallback: 1.05 },
  { key: 'h6Scale', label: '标题6', fallback: 1 }
]

function scaleOf(key: string, fallback: number): number {
  const v = (props.typo as unknown as Record<string, number | undefined>)[key]
  return v ?? fallback
}

function setScale(key: string, ev: Event): void {
  const v = Math.round(Number((ev.target as HTMLInputElement).value) * 100) / 100
  ;(props.typo as unknown as Record<string, number>)[key] = v
}
</script>

<template>
  <div class="tf-form">
    <section class="tf-sec">
      <h4>正文</h4>
      <label class="tf-field">
        <span>字体</span>
        <FontSelect
          :model-value="props.typo.bodyFont"
          title="正文字体"
          @update:model-value="(v: string) => (props.typo.bodyFont = v)"
        />
      </label>
      <label class="tf-field">
        <span>字号 px</span>
        <input
          v-model.number="props.typo.bodySize"
          type="number"
          min="10"
          max="40"
          class="input num"
        />
      </label>
      <label class="tf-field">
        <span>行距</span>
        <input v-model="props.typo.bodyLineHeight" class="input" placeholder="如 1.75" />
      </label>
      <label class="tf-field">
        <span>文字颜色</span>
        <input v-model="props.typo.bodyColor" type="color" class="input color" />
      </label>
      <label class="tf-field">
        <span>段前磅</span>
        <input
          v-model.number="props.typo.spaceBeforePt"
          type="number"
          min="0"
          max="220"
          class="input num"
          placeholder="不设"
        />
      </label>
      <label class="tf-field">
        <span>段后磅</span>
        <input
          v-model.number="props.typo.spaceAfterPt"
          type="number"
          min="0"
          max="220"
          class="input num"
          placeholder="不设"
        />
      </label>
      <label class="tf-field">
        <span>首行缩进</span>
        <input v-model="props.typo.defaultTextIndent" class="input" placeholder="如 2em，空为不设" />
      </label>
    </section>

    <section class="tf-sec">
      <h4>标题</h4>
      <label class="tf-field">
        <span>字体</span>
        <FontSelect
          :model-value="props.typo.headingFont"
          title="标题字体"
          @update:model-value="(v: string) => (props.typo.headingFont = v)"
        />
      </label>
      <label class="tf-field">
        <span>颜色</span>
        <input v-model="props.typo.headingColor" type="color" class="input color" />
      </label>
      <label v-for="s in scaleFields" :key="s.key" class="tf-field">
        <span :title="`${s.label} 字号 = 正文字号 × 缩放（缺省 ${s.fallback}）`">{{ s.label }} 缩放</span>
        <input
          :value="scaleOf(s.key, s.fallback)"
          type="number"
          step="0.05"
          min="0.6"
          max="4"
          class="input num"
          @change="setScale(s.key, $event)"
        />
      </label>
      <label class="tf-field">
        <span>引用颜色</span>
        <input v-model="props.typo.quoteColor" type="color" class="input color" />
      </label>
    </section>
  </div>
</template>

<style scoped>
/* 侧栏只有 292px：输入框按内容宽度封顶，既不用整行拉宽也不会溢出 */
.tf-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px 18px;
  width: 100%;
  padding: 2px 14px 14px;
}

.tf-sec {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.tf-sec h4 {
  margin: 0;
  font-size: 13px;
  color: var(--ink);
}

.tf-field {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tf-field > span {
  /* 72px 容得下最长的「大标题 缩放」不换行；72+8+152(输入上限)=232 < 侧栏实宽 248 */
  width: 72px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--ink-soft);
}

.tf-field .input {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 152px;
}

.tf-field .input.num {
  max-width: 72px;
}

.tf-field .input.color {
  flex: 0 0 44px;
  width: 44px;
  height: 26px;
  padding: 2px;
}

/* FontSelect 的根按钮拿不到本组件的 scope id，只能用 :deep 同样封顶 */
.tf-field :deep(.font-select-btn) {
  flex: 1 1 auto;
  min-width: 0;
  max-width: 152px;
}
</style>
