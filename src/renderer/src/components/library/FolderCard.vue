<script setup lang="ts">
import { computed } from 'vue'
import type { DocCardInfo } from '@shared/types'
import type { FolderNode } from '../../stores/library'
import GlyphIcon from '../common/GlyphIcon.vue'
import DocCardTile from './DocCardTile.vue'
import { useCardMenu } from '../../composables/cardMenu'

const props = defineProps<{
  folder: FolderNode
  /** 文件夹内（含子级）最近的文档卡片，缩小后从封面下沿开口露出 */
  previews: DocCardInfo[]
}>()

const emit = defineEmits<{
  (e: 'open'): void
  (e: 'remove'): void
}>()

const { isOpen: menuOpen, pos: menuPos, toggle: toggleMenu, close: closeMenu } = useCardMenu()

/** 预览卡 = 文档卡片等比缩小到 90%（320x162 -> 288x146），越界部分裁掉；
 * 第二张叠在第一张之上、封面之下，较第一张上移 14px、反向旋转 1° */
const MINI_W = 288
const MINI_H = 146

const minis = computed(() => {
  const list = props.previews.slice(0, 2)
  return list.map((c, i) => ({
    card: c,
    right: '5%',
    bottom: i === 0 ? 4 : 18,
    rotate: i === 0 ? 2 : -1,
    z: i + 1
  }))
})

function openMenu(ev: MouseEvent): void {
  ev.stopPropagation()
  toggleMenu(ev.currentTarget as HTMLElement)
}
</script>

<template>
  <article class="folder-tile" @click="emit('open')">
    <div class="ft-minis">
      <div
        v-for="m in minis"
        :key="m.card.meta.id"
        class="ft-mini"
        :style="{ right: m.right, bottom: `${m.bottom}px`, width: `${MINI_W}px`, height: `${MINI_H}px`, zIndex: m.z, transform: `rotate(${m.rotate}deg)` }"
      >
        <DocCardTile class="ft-mini-card" :card="m.card" />
      </div>
    </div>
    <svg v-if="minis.length" class="ft-cover" viewBox="0 0 332 117" preserveAspectRatio="none" aria-hidden="true">
      <path
        vector-effect="non-scaling-stroke"
        d="M 12,0 L 320,0 A 12,12 0 0 1 332,12 L 332,81.1 Q 332,87.1 319.1,87.7 L 132.8,96.1
           L 132.8,105.6 Q 132.8,108.6 126.8,108.8 L 24.2,110.3 Q 18.2,110.5 18.2,107.5
           L 18.2,101.3 L 17.6,101.3 Q 0,101.9 0,95.6 L 0,12 A 12,12 0 0 1 12,0 Z"
      />
    </svg>
    <svg
      v-else
      class="ft-cover ft-cover-empty"
      viewBox="0 0 332 162"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path
        vector-effect="non-scaling-stroke"
        d="M 12.5,0.5 L 319.5,0.5 A 12,12 0 0 1 331.5,12.5 L 331.5,134 A 12,12 0 0 1 319.5,146
           L 133,146 L 133,155 A 6,6 0 0 1 127,161 L 24,161 A 6,6 0 0 1 18,155 L 18,146
           L 12.5,146 A 12,12 0 0 1 0.5,134 L 0.5,12.5 A 12,12 0 0 1 12.5,0.5 Z"
      />
    </svg>
    <div class="ft-title">{{ folder.name }}</div>
    <span class="ft-menu">
      <button class="ft-menu-btn" @click="openMenu">
        <GlyphIcon name="menu" :size="15" />
      </button>
    </span>
    <Teleport to="body">
      <div
        v-if="menuOpen"
        class="menu-pop card-menu"
        :style="{ left: `${menuPos.left}px`, top: `${menuPos.top}px` }"
        @click.stop
      >
        <button class="danger" @click="closeMenu(); emit('remove')">删除</button>
      </div>
    </Teleport>
  </article>
</template>

<style scoped>
.folder-tile {
  position: relative;
  height: var(--tile-h, 162px);
  overflow: hidden;
  cursor: pointer;
  background: transparent;
  transition: transform 0.15s;
  user-select: none;
}

.folder-tile:hover {
  transform: translateY(-1px);
}

/* 缩小的文档卡片：藏在封面之后，从下沿开口露出 */
.ft-minis {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.ft-mini {
  position: absolute;
  bottom: 4px;
  overflow: hidden;
}

.ft-mini-card {
  width: 320px;
  transform: scale(0.9);
  transform-origin: top left;
}

/* 封面：green-bubble 造型，颜色跟主题变量 */
.ft-cover {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 72%;
  z-index: 2;
  pointer-events: none;
  overflow: visible;
}

/* 空文件夹封面：圆角矩形+底部凸舌，整体与文档卡同高、凸舌与气泡封面等宽 */
.ft-cover-empty {
  height: 100%;
}

.ft-cover path {
  fill: var(--folder-front);
  stroke: var(--folder-back);
  stroke-width: 1;
  stroke-linejoin: round;
  filter: drop-shadow(2px 5px 4px rgb(31 27 23 / 28%));
}

/* 空封面一切阴影移除：需放在 .ft-cover path 之后并提高特异性，否则被共用规则覆盖 */
.ft-cover.ft-cover-empty path {
  filter: none;
}

/* 名称与文档卡片标题位置一致 */
.ft-title {
  position: absolute;
  top: 46px;
  left: 16px;
  right: 56px;
  z-index: 3;
  font-size: 21px;
  font-weight: 700;
  line-height: 1.3;
  color: #14120f;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.ft-menu {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
}

.ft-menu-btn {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: #fff;
  color: var(--ink);
}

.ft-menu-btn:hover {
  background: var(--accent-soft);
}
</style>
