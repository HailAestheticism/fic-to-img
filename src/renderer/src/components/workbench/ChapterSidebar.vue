<script setup lang="ts">
import { reactive, watch } from 'vue'
import type { SplitRules } from '@shared/types'
import type { ChapterItem } from '../../editor/chapters'

const props = defineProps<{
  chapters: ChapterItem[]
  activeId: string
  rules: SplitRules
  /** 混合界面要先点中一个正文块才能插入章节符 */
  insertEnabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'jump', pos: number, chapterId: string): void
  (e: 'insert-break'): void
  (e: 'update-rules', rules: SplitRules): void
}>()

const showRules = defineModel<boolean>('showRules', { default: false })

const form = reactive<SplitRules>({ ...props.rules })

watch(
  () => props.rules,
  (r) => {
    if (JSON.stringify(r) !== JSON.stringify(form)) Object.assign(form, r)
  },
  { deep: true }
)

function pushRules(): void {
  emit('update-rules', { ...form, pattern: form.pattern.trim() })
}

function kindLabel(kind: ChapterItem['kind']): string {
  return kind === 'break' ? '符' : kind === 'heading' ? '题' : '序'
}

function kindTitle(kind: ChapterItem['kind']): string {
  return kind === 'break' ? '手动章节符' : kind === 'heading' ? '标题自动分割' : '文档开头'
}
</script>

<template>
  <aside class="chapter-sidebar">
    <header class="cs-head">
      <span>章节</span>
      <button class="icon-btn" title="分割规则" @click="showRules = !showRules">⚙</button>
    </header>

    <div v-if="showRules" class="cs-rules">
      <p class="cs-rules-hint">手动插入的章节符始终生效；以下规则作用于标题：</p>
      <label class="check">
        <input v-model="form.h1" type="checkbox" @change="pushRules" />
        按一级标题（H1）分章
      </label>
      <label class="check">
        <input v-model="form.regex" type="checkbox" @change="pushRules" />
        按正则匹配标题分章
      </label>
      <input
        v-model="form.pattern"
        class="input"
        placeholder="正则，如 ^第[0-9一二三四五六七八九十百千]+章"
        :disabled="!form.regex"
        @change="pushRules"
      />
      <p class="muted cs-rules-note">命中的标题会被标记为章节起点，并随文档保存。</p>
    </div>

    <div class="cs-list">
      <button
        v-for="c in chapters"
        :key="c.chapterId"
        class="cs-item"
        :class="{ active: c.chapterId === activeId }"
        :title="c.title"
        @click="emit('jump', c.pos, c.chapterId)"
      >
        <span class="cs-kind" :title="kindTitle(c.kind)">{{ kindLabel(c.kind) }}</span>
        <span class="cs-title">{{ c.title }}</span>
      </button>
      <p v-if="!chapters.length" class="muted cs-empty">暂无章节</p>
    </div>

    <footer class="cs-foot">
      <button
        class="btn small"
        :disabled="props.insertEnabled === false"
        :title="
          props.insertEnabled === false
            ? '先在页面上点击一段正文，章节符会插在它之前'
            : '插入章节符'
        "
        @click="emit('insert-break')"
      >
        ＋ 插入章节符
      </button>
    </footer>
  </aside>
</template>
