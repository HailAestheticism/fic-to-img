<script setup lang="ts">
import { computed } from 'vue'
import type { DocCardInfo, DocMeta } from '@shared/types'
import { useLibraryStore } from '../../stores/library'
import type { FolderNode } from '../../stores/library'
import DocCardTile from './DocCardTile.vue'
import FolderCard from './FolderCard.vue'

const lib = useLibraryStore()

const emit = defineEmits<{
  (e: 'open-doc', doc: DocMeta): void
  (e: 'detail-card', card: DocCardInfo): void
  (e: 'rename-doc', doc: DocMeta): void
  (e: 'copy-doc', doc: DocMeta): void
  (e: 'remove-doc', doc: DocMeta): void
  (e: 'remove-folder', path: string): void
}>()

const crumbs = computed(() => ['文档库', ...lib.browsePath])

function gotoCrumb(i: number): void {
  lib.browsePath = i === 0 ? [] : lib.browsePath.slice(0, i)
}

/** 文件夹（含子级）内最近的文档卡片，用于文件夹图形露出的卡片下沿 */
const previewsByPath = computed<Record<string, DocCardInfo[]>>(() => {
  const map: Record<string, DocCardInfo[]> = {}
  const walk = (nodes: FolderNode[]): DocCardInfo[] => {
    const out: DocCardInfo[] = []
    for (const n of nodes) {
      const kids = [...n.docs.map((d) => lib.cardById[d.id]).filter(Boolean) as DocCardInfo[], ...walk(n.children)]
      kids.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
      map[n.path] = kids
      out.push(...kids)
    }
    return out
  }
  walk(lib.tree)
  return map
})
</script>

<template>
  <main class="showcase">
    <nav class="crumbs">
      <template v-for="(c, i) in crumbs" :key="i">
        <span v-if="i > 0" class="crumb-sep">›</span>
        <button class="crumb" :class="{ current: i === crumbs.length - 1 }" :disabled="lib.searching" @click="gotoCrumb(i)">
          {{ c }}
        </button>
      </template>
      <span v-if="lib.searching" class="crumb-hint">搜索「{{ lib.query.trim() }}」的结果（全库）</span>
    </nav>

    <div v-if="lib.browseFolders.length || lib.browseCards.length" class="case-grid">
      <FolderCard
        v-for="f in lib.browseFolders"
        :key="`f:${f.path}`"
        :folder="f"
        :previews="previewsByPath[f.path] ?? []"
        @open="lib.browsePath = [...lib.browsePath, f.name]"
        @remove="emit('remove-folder', f.path)"
      />
      <DocCardTile
        v-for="c in lib.browseCards"
        :key="c.meta.id"
        :card="c"
        @open="emit('open-doc', c.meta)"
        @detail="emit('detail-card', c)"
        @rename="emit('rename-doc', c.meta)"
        @copy="emit('copy-doc', c.meta)"
        @remove="emit('remove-doc', c.meta)"
      />
    </div>
    <div v-else class="empty">
      <p>{{ lib.loading ? '加载中…' : '这个文件夹还是空的' }}</p>
      <p class="muted">点右上角「＋ 新建文档」或「导入」开始，或「＋ 新建文件夹」整理文档库。</p>
    </div>
  </main>
</template>

<style scoped>
.showcase {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 10px 24px 0;
  font-size: 13px;
  flex-wrap: wrap;
}

.crumb {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 6px;
}

.crumb:hover:not(:disabled) {
  background: var(--accent-soft);
}

.crumb.current {
  color: var(--ink);
  font-weight: 600;
}

.crumb-sep {
  color: var(--muted);
}

.crumb-hint {
  margin-left: 8px;
  color: var(--muted);
  font-size: 12px;
}

.case-grid {
  flex: 1;
  overflow-y: auto;
  padding: 14px 24px 40px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 18px;
  align-content: start;
}
</style>
