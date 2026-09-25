<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { DocCardInfo, DocMeta } from '@shared/types'
import { api } from '../api'
import { useAppStore } from '../stores/app'
import { useLibraryStore } from '../stores/library'
import type { LibraryViewKind } from '../stores/library'
import { SORT_OPTIONS } from '../stores/library'
import DocDetails from '../components/library/DocDetails.vue'
import DocMetaDialog from '../components/library/DocMetaDialog.vue'
import ShowcaseView from '../components/library/ShowcaseView.vue'
import TreeView from '../components/library/TreeView.vue'
import MindMapView from '../components/library/MindMapView.vue'
import Modal from '../components/common/Modal.vue'

const app = useAppStore()
const lib = useLibraryStore()

const editing = ref<DocMeta | null>(null)
const deleting = ref<DocMeta | null>(null)
const deletingFolder = ref<string | null>(null)
const folderError = ref('')
const importing = ref(false)
const newFolder = ref<string | null>(null)
const newFolderName = ref('')
const detailCard = ref<DocCardInfo | null>(null)

const VIEW_LABELS: { key: LibraryViewKind; label: string }[] = [
  { key: 'browse', label: '展柜' },
  { key: 'tree', label: '目录树' },
  { key: 'mind', label: '思维导图' }
]

let searchTimer: ReturnType<typeof setTimeout> | undefined
let offMenu: (() => void) | null = null

onMounted(() => {
  void lib.refresh()
  offMenu = api.onMenuAction((action) => {
    if (action === 'import') void onImport()
    else if (action === 'mobile') app.openMobilePanel()
  })
})

onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  offMenu?.()
})

function onQueryInput(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void lib.runSearch(), 300)
}

function toggleTag(tag: string): void {
  const list = lib.activeTags
  lib.activeTags = list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]
}

function openDoc(doc: DocMeta): void {
  app.openDoc(doc.id)
}

const currentFolder = computed(() => lib.browsePath.join('/'))

async function onCreate(): Promise<void> {
  const meta = await lib.createDoc(lib.browsePath.length ? { folder: currentFolder.value } : undefined)
  app.openDoc(meta.id)
}

function askNewFolder(): void {
  newFolderName.value = ''
  newFolder.value = 'ask'
}

async function confirmNewFolder(): Promise<void> {
  const name = newFolderName.value.trim()
  if (!name) return
  await lib.createFolder(name)
  newFolder.value = null
}

async function onImport(): Promise<void> {
  const paths = await api.dialog.openFile({
    title: '导入文档（.txt / .md / .html）',
    filters: [
      { name: '文本文档', extensions: ['txt', 'md', 'markdown', 'html', 'htm'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    multi: true
  })
  if (!paths.length) return
  importing.value = true
  try {
    await lib.importDocs(paths)
  } finally {
    importing.value = false
  }
}

async function onCopy(doc: DocMeta): Promise<void> {
  await lib.copyDoc(doc.id)
}

async function onRemove(): Promise<void> {
  if (!deleting.value) return
  await lib.removeDoc(deleting.value.id)
  deleting.value = null
}

async function onRemoveFolder(): Promise<void> {
  if (!deletingFolder.value) return
  folderError.value = ''
  try {
    await lib.removeFolder(deletingFolder.value)
    deletingFolder.value = null
  } catch (e) {
    folderError.value = e instanceof Error ? e.message : '删除失败'
  }
}

async function onSaveMeta(patch: { title: string; folder: string; tags: string[] }): Promise<void> {
  if (!editing.value) return
  await lib.updateMeta(editing.value.id, patch)
  editing.value = null
}
</script>

<template>
  <div class="library">
    <header class="lib-header">
      <div class="lib-left">
        <span class="search-box">
          <input
            v-model="lib.query"
            class="input search"
            placeholder="搜索标题、标签、文件夹…"
            @input="onQueryInput"
          />
          <button
            class="search-full"
            :class="{ active: lib.contentSearch }"
            @click="lib.contentSearch = !lib.contentSearch; onQueryInput()"
          >
            {{ lib.contentSearch ? '全文搜索 开' : '全文搜索 关' }}
          </button>
        </span>
        <select v-model="lib.sortMode" class="input sort-select" title="排序方式">
          <option v-for="s in SORT_OPTIONS" :key="s.key" :value="s.key">{{ s.label }}</option>
        </select>
      </div>
      <div class="view-switch">
        <button
          v-for="v in VIEW_LABELS"
          :key="v.key"
          class="view-btn"
          :class="{ active: lib.view === v.key }"
          @click="lib.view = v.key"
        >
          {{ v.label }}
        </button>
      </div>
      <div class="lib-tools">
        <button class="btn folder-accent" @click="askNewFolder">＋ 新建文件夹</button>
        <button class="btn primary" @click="onCreate">＋ 新建文档</button>
      </div>
    </header>

    <div v-if="lib.allTags.length" class="tag-bar">
      <button
        class="tag-chip"
        :class="{ active: !lib.activeTags.length }"
        @click="lib.activeTags = []"
      >
        全部
      </button>
      <button
        v-for="t in lib.allTags"
        :key="t"
        class="tag-chip"
        :class="{ active: lib.activeTags.includes(t) }"
        @click="toggleTag(t)"
      >
        {{ t }}
      </button>
    </div>

    <TreeView
      v-if="lib.view === 'tree'"
      @open-doc="openDoc"
      @rename-doc="(d) => (editing = d)"
      @copy-doc="onCopy"
      @remove-doc="(d) => (deleting = d)"
    />

    <MindMapView
      v-else-if="lib.view === 'mind'"
      @open-doc="openDoc"
      @detail-card="(c) => (detailCard = c)"
      @rename-doc="(d) => (editing = d)"
      @copy-doc="onCopy"
      @remove-doc="(d) => (deleting = d)"
    />

    <ShowcaseView
      v-else
      @open-doc="openDoc"
      @detail-card="(c) => (detailCard = c)"
      @rename-doc="(d) => (editing = d)"
      @copy-doc="onCopy"
      @remove-doc="(d) => (deleting = d)"
      @remove-folder="(p) => { folderError = ''; deletingFolder = p }"
    />

    <DocMetaDialog v-if="editing" :doc="editing" @close="editing = null" @save="onSaveMeta" />

    <Modal v-if="detailCard" title="文档详情" wide @close="detailCard = null">
      <div class="detail-scroll">
        <DocDetails :card="detailCard" />
      </div>
      <template #footer>
        <button class="btn" @click="detailCard = null">关闭</button>
        <button class="btn primary" @click="openDoc(detailCard.meta); detailCard = null">进入编辑</button>
      </template>
    </Modal>

    <Modal v-if="newFolder" title="新建文件夹" @close="newFolder = null">
      <p class="dlg-tip">文件夹名称，支持多级（用 / 分隔），将建在当前路径下。</p>
      <input
        v-model="newFolderName"
        class="input dlg-input"
        placeholder="如：小说 或 小说/第一卷"
        @keydown.enter="confirmNewFolder"
      />
      <template #footer>
        <button class="btn" @click="newFolder = null">取消</button>
        <button class="btn primary" :disabled="!newFolderName.trim()" @click="confirmNewFolder">创建</button>
      </template>
    </Modal>

    <Modal v-if="deleting" title="删除文档" @close="deleting = null">
      <p>确定删除《{{ deleting.title }}》？该文档的全部内容与历史快照将一并删除，且不可恢复。</p>
      <template #footer>
        <button class="btn" @click="deleting = null">取消</button>
        <button class="btn danger" @click="onRemove">删除</button>
      </template>
    </Modal>

    <Modal v-if="deletingFolder" title="删除文件夹" @close="deletingFolder = null">
      <p>确定删除文件夹「{{ deletingFolder }}」？仅允许删除空文件夹。</p>
      <p v-if="folderError" class="dlg-error">{{ folderError }}</p>
      <template #footer>
        <button class="btn" @click="deletingFolder = null">取消</button>
        <button class="btn danger" @click="onRemoveFolder">删除</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.search-box {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.search-box .search {
  width: 200px;
  padding-right: 100px;
}

.search-full {
  position: absolute;
  right: 4px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: var(--panel-soft);
  color: var(--muted);
  font-size: 11px;
  padding: 2px 7px;
  white-space: nowrap;
}

.search-full:hover {
  color: var(--ink);
}

.search-full.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.sort-select {
  max-width: 118px;
}

.dlg-tip {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
}

.dlg-input {
  width: 100%;
}

.dlg-error {
  margin-top: 8px;
  color: var(--danger);
  font-size: 13px;
}

.detail-scroll {
  max-height: 60vh;
  overflow-y: auto;
  padding-right: 4px;
}
</style>
