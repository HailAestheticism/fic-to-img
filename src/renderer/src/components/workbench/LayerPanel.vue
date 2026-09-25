<script setup lang="ts">
/**
 * 排版图层面板（元素添加/操作 + 背景填充）。图层切换双键已上提到侧栏顶部
 * 吸顶渲染（`LayerSwitch.vue`，与混合界面三键同交互），本面板只随 props.layer 显示对应内容。
 * 背景层 = 添加元素 + 纯色/渐变/图片填充（图片含 5 种铺法）；最顶层只有添加元素、无作用范围。
 * `bgOnly` 为预设编辑界面：只剩全局背景（无图层元素与作用范围切换），选图落到预设自带资源。
 */
import { computed, ref, watch } from 'vue'
import type {
  ActivePageInfo,
  BackgroundSpec,
  DocLayout,
  FreeElement,
  ImageAnchor,
  ImageFit,
  LayoutLayer,
  MultiImageSpec
} from '@shared/types'
import { ANCHORED_FITS } from '@shared/paper'
import { api } from '../../api'
import type { ElementScope } from '../../freelay/fabric-service'
import BgFitIcon from '../common/BgFitIcon.vue'

const props = defineProps<{
  docId: string
  layer: LayoutLayer
  active: ActivePageInfo | null
  hasSelection: boolean
  backgrounds: DocLayout['backgrounds']
  /** 预设编辑：只显示全局背景 */
  bgOnly?: boolean
}>()

const emit = defineEmits<{
  (
    e: 'add',
    kind: FreeElement['kind'],
    scope: ElementScope,
    opts?: { src?: string; variant?: string }
  ): void
  (e: 'brush-toggle', on: boolean): void
  (e: 'del'): void
  (e: 'dup'): void
  (e: 'opacity', v: number): void
  (e: 'bg', spec: BackgroundSpec | null, scope: ElementScope): void
}>()

const isBg = computed(() => props.bgOnly || props.layer !== 'top')
const scopeSel = ref<'global' | 'chapter' | 'page'>('page')
const brushOn = ref(false)
const opacity = ref(1)

const GRADIENTS: { label: string; value: string }[] = [
  { label: '暖纸', value: 'linear-gradient(135deg, #f7efe2 0%, #eadbc4 100%)' },
  { label: '云白', value: 'linear-gradient(160deg, #fdfbfb 0%, #e9edf0 100%)' },
  { label: '晴空', value: 'linear-gradient(180deg, #eef4fb 0%, #d8e9fa 100%)' },
  { label: '薄荷', value: 'linear-gradient(135deg, #e9f5ec 0%, #d3ead8 100%)' },
  { label: '蔷薇', value: 'linear-gradient(135deg, #fbe9e7 0%, #f6d5d8 100%)' },
  { label: '夜幕', value: 'linear-gradient(160deg, #2f2a26 0%, #4a4038 100%)' }
]

const FITS: { v: ImageFit; l: string; hint: string }[] = [
  { v: 'fill', l: '充满', hint: '等比放大铺满画布，至少两条平行边与画布重合（可再选锚点）' },
  { v: 'stretch', l: '拉伸', hint: '拉伸到四边四角全部与画布重合' },
  { v: 'tile', l: '平铺', hint: '保留原尺寸，像地砖一样铺满（可再选锚点）' },
  { v: 'offset-tile', l: '错位平铺', hint: '平铺但相邻列起始高度相差半张图（可再选锚点）' },
  { v: 'multi', l: '多图', hint: '页首/页尾各一张图，中间用第三张图或纯色/渐变补足' }
]

const ANCHORS: { v: ImageAnchor; l: string }[] = [
  { v: 'tl', l: '左上角' },
  { v: 'center', l: '居中' },
  { v: 'tr', l: '右上角' }
]

const ANCHOR_FITS = ANCHORED_FITS

/** 中间区域不能用「多图」 */
const MID_FITS: { v: Exclude<ImageFit, 'multi'>; l: string; hint: string }[] = FITS.filter(
  (f) => f.v !== 'multi'
) as { v: Exclude<ImageFit, 'multi'>; l: string; hint: string }[]

/** 背景编辑状态 */
const bgKind = ref<'none' | 'color' | 'gradient' | 'image'>('none')
const bgColor = ref('#f5f0e6')
const imageFit = ref<ImageFit>('fill')
const imageAnchor = ref<ImageAnchor>('center')
const imageUrl = ref('')
const imageName = ref('')
const multi = ref<MultiImageSpec>({ midKind: 'image', midFit: 'fill', midAnchor: 'center' })
const bgGradientValue = ref('')

function scope(): ElementScope {
  if (props.bgOnly) return { type: 'global' }
  const a = props.active
  if (!a) return { type: 'global' }
  if (!isBg.value || scopeSel.value === 'page') {
    return { type: 'page', chapterId: a.chapterId, pageIndex: a.pageIndex }
  }
  if (scopeSel.value === 'chapter') return { type: 'chapter', chapterId: a.chapterId }
  return { type: 'global' }
}

const scopeLabel = computed(() =>
  props.bgOnly
    ? '全局'
    : !isBg.value
      ? '当前页'
      : scopeSel.value === 'global'
        ? '全局（所有页）'
        : scopeSel.value === 'chapter'
          ? '当前章'
          : '当前页'
)

function currentBg(): BackgroundSpec | null {
  const a = props.active
  const bgs = props.backgrounds
  if (props.bgOnly || !isBg.value || scopeSel.value === 'global' || !a) return bgs.global ?? null
  if (scopeSel.value === 'chapter') return bgs.chapter[a.chapterId] ?? null
  return bgs.page[`${a.chapterId}:${a.pageIndex}`] ?? null
}

/** 切范围/切页时把面板读数同步为该范围已有的背景设置 */
watch(
  () => [props.layer, scopeSel.value, props.active?.chapterId, props.active?.pageIndex],
  () => {
    const bg = currentBg()
    if (!bg) {
      bgKind.value = 'none'
      return
    }
    if (bg.kind === 'color') {
      bgKind.value = 'color'
      if (bg.color) bgColor.value = bg.color
      return
    }
    if (bg.kind === 'gradient') {
      bgKind.value = 'gradient'
      bgGradientValue.value = bg.gradient ?? ''
      return
    }
    bgKind.value = 'image'
    if (bg.kind === 'texture') {
      imageFit.value = 'tile'
      imageAnchor.value = 'tl'
      imageUrl.value = bg.textureUrl ?? ''
      return
    }
    imageFit.value = bg.imageFit ?? 'fill'
    imageAnchor.value = bg.imageAnchor ?? 'center'
    imageUrl.value = bg.imageUrl ?? ''
    imageName.value = bg.imageName ?? ''
    multi.value = { midKind: 'image', midFit: 'fill', midAnchor: 'center', ...bg.multi }
  },
  { immediate: true }
)

function add(kind: FreeElement['kind'], opts?: { src?: string; variant?: string }): void {
  emit('add', kind, scope(), opts)
}

async function pickImage(title: string): Promise<{ url: string; name: string } | null> {
  const paths = await api.dialog.openFile({
    title,
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }]
  })
  if (!paths.length) return null
  // 预设编辑没有宿主文档：图片落到预设自带资源目录
  const assets = props.bgOnly
    ? await api.assets.importPreset(paths)
    : await api.assets.import(props.docId, paths)
  if (!assets.length) return null
  return { url: assets[0].url, name: assets[0].name }
}

function addSticker(): void {
  void (async () => {
    const picked = await pickImage('选择贴纸图片')
    if (picked) add('sticker', { src: picked.url })
  })()
}

function toggleBrush(): void {
  brushOn.value = !brushOn.value
  emit('brush-toggle', brushOn.value)
}

function spec(): BackgroundSpec | null {
  if (bgKind.value === 'none') return null
  if (bgKind.value === 'color') return { kind: 'color', color: bgColor.value }
  if (bgKind.value === 'gradient') {
    return bgGradientValue.value
      ? { kind: 'gradient', gradient: bgGradientValue.value }
      : null
  }
  if (imageFit.value === 'multi') {
    return { kind: 'image', imageFit: 'multi', imageAnchor: imageAnchor.value, multi: multi.value }
  }
  if (!imageUrl.value) return null
  return {
    kind: 'image',
    imageUrl: imageUrl.value,
    imageName: imageName.value,
    imageFit: imageFit.value,
    imageAnchor: imageAnchor.value
  }
}

/** 把当前面板状态写回文档；设置尚不完整（缺图/缺色）时不清空已有背景 */
function applyBg(): void {
  const s = spec()
  if (!s && bgKind.value !== 'none') return
  emit('bg', s, scope())
}

function setBgKind(k: 'none' | 'color' | 'gradient' | 'image'): void {
  bgKind.value = k
  if (k === 'gradient' && !bgGradientValue.value) bgGradientValue.value = GRADIENTS[0].value
  applyBg()
}

function setGradient(g: string): void {
  bgKind.value = 'gradient'
  bgGradientValue.value = g
  applyBg()
}

function setColor(): void {
  bgKind.value = 'color'
  applyBg()
}

async function chooseBgImage(): Promise<void> {
  const picked = await pickImage('选择背景图')
  if (!picked) return
  imageUrl.value = picked.url
  imageName.value = picked.name
  bgKind.value = 'image'
  applyBg()
}

function setFit(f: ImageFit): void {
  imageFit.value = f
  bgKind.value = 'image'
  applyBg()
}

function setAnchor(a: ImageAnchor): void {
  imageAnchor.value = a
  applyBg()
}

async function pickMulti(which: 'top' | 'bottom' | 'mid'): Promise<void> {
  const picked = await pickImage(
    which === 'top' ? '选择页首图' : which === 'bottom' ? '选择页尾图' : '选择中间填充图'
  )
  if (!picked) return
  const m = { ...multi.value }
  if (which === 'top') {
    m.topUrl = picked.url
    m.topName = picked.name
  } else if (which === 'bottom') {
    m.bottomUrl = picked.url
    m.bottomName = picked.name
  } else {
    m.midUrl = picked.url
    m.midName = picked.name
    m.midKind = 'image'
  }
  multi.value = m
  bgKind.value = 'image'
  imageFit.value = 'multi'
  applyBg()
}

function clearMulti(which: 'top' | 'bottom' | 'mid'): void {
  const m = { ...multi.value }
  if (which === 'top') {
    m.topUrl = undefined
    m.topName = undefined
  } else if (which === 'bottom') {
    m.bottomUrl = undefined
    m.bottomName = undefined
  } else {
    m.midUrl = undefined
    m.midName = undefined
  }
  multi.value = m
  applyBg()
}

function setMidKind(k: 'image' | 'color' | 'gradient'): void {
  multi.value = { ...multi.value, midKind: k }
  applyBg()
}

function setMidFit(f: Exclude<ImageFit, 'multi'>): void {
  multi.value = { ...multi.value, midKind: 'image', midFit: f }
  applyBg()
}

function setMidAnchor(a: ImageAnchor): void {
  multi.value = { ...multi.value, midAnchor: a }
  applyBg()
}

function setMidColor(v: string): void {
  multi.value = { ...multi.value, midKind: 'color', midColor: v }
  applyBg()
}

function setMidGradient(v: string): void {
  multi.value = { ...multi.value, midKind: 'gradient', midGradient: v }
  applyBg()
}

const showMulti = computed(() => bgKind.value === 'image' && imageFit.value === 'multi')
const showAnchor = computed(() => ANCHOR_FITS.includes(imageFit.value))

const BG_KINDS: { v: 'none' | 'color' | 'gradient' | 'image'; l: string }[] = [
  { v: 'none', l: '无' },
  { v: 'color', l: '纯色' },
  { v: 'gradient', l: '渐变' },
  { v: 'image', l: '图片' }
]
</script>

<template>
  <section class="layer-panel">
    <div v-if="isBg && !bgOnly" class="lp-scope">
      <span class="sp-label">作用范围</span>
      <select v-model="scopeSel" class="input">
        <option value="global">全局</option>
        <option value="chapter" :disabled="!active">当前章</option>
        <option value="page" :disabled="!active">当前页</option>
      </select>
    </div>
    <p v-if="bgOnly" class="muted lp-active">预设背景作用于套用了该预设的所有页</p>
    <p v-else-if="active" class="muted lp-active">
      第 {{ active.index + 1 }} 页 · {{ active.chapterTitle }}（章内第 {{ active.pageIndex + 1 }} 页）
    </p>
    <p v-else class="muted lp-active">点击左侧页面后可使用「当前章 / 当前页」</p>

    <div v-if="!bgOnly" class="sp-group">
      <span class="sp-label">添加元素到「{{ scopeLabel }}」</span>
      <div class="lp-btns">
        <button class="btn small" @click="addSticker">贴纸</button>
        <button class="btn small" @click="add('shape', { variant: 'rect' })">矩形</button>
        <button class="btn small" @click="add('shape', { variant: 'circle' })">圆形</button>
        <button class="btn small" @click="add('shape', { variant: 'triangle' })">三角</button>
        <button class="btn small" @click="add('line')">线条</button>
        <button class="btn small" @click="add('text')">文字</button>
        <button class="btn small" @click="add('watermark')">水印</button>
        <button class="btn small" :class="{ active: brushOn }" @click="toggleBrush">
          {{ brushOn ? '画笔·开' : '画笔' }}
        </button>
      </div>
    </div>

    <div v-if="!bgOnly" class="sp-group" :class="{ disabled: !hasSelection }">
      <span class="sp-label">选中元素</span>
      <div class="lp-btns">
        <button class="btn small" :disabled="!hasSelection" @click="emit('dup')">复制</button>
        <button class="btn small" :disabled="!hasSelection" @click="emit('del')">删除</button>
      </div>
      <label class="lp-opacity">
        <span class="sp-label">不透明度</span>
        <input
          v-model.number="opacity"
          type="range"
          min="0.05"
          max="1"
          step="0.05"
          :disabled="!hasSelection"
          @input="emit('opacity', opacity)"
        />
      </label>
    </div>

    <template v-if="isBg">
      <div class="sp-group">
        <span class="sp-label">背景（{{ scopeLabel }}）</span>
        <div class="lp-btns">
          <button
            v-for="k in BG_KINDS"
            :key="k.v"
            class="btn small"
            :class="{ active: bgKind === k.v }"
            @click="setBgKind(k.v)"
          >
            {{ k.l }}
          </button>
        </div>

        <div v-if="bgKind === 'color'" class="lp-row">
          <input v-model="bgColor" type="color" class="tb-color" @input="setColor" />
          <button class="btn small" @click="setColor">应用颜色</button>
        </div>

        <div v-if="bgKind === 'gradient'" class="lp-swatches">
          <button
            v-for="g in GRADIENTS"
            :key="g.value"
            class="lp-swatch"
            :class="{ on: bgGradientValue === g.value }"
            :style="{ background: g.value }"
            :title="g.label"
            @click="setGradient(g.value)"
          />
        </div>

        <div v-if="bgKind === 'image'" class="lp-img-editor">
          <div class="lp-fits">
            <button
              v-for="f in FITS"
              :key="f.v"
              class="lp-fit"
              :class="{ on: imageFit === f.v }"
              :title="f.hint"
              @click="setFit(f.v)"
            >
              <BgFitIcon :fit="f.v" />
              <span>{{ f.l }}</span>
            </button>
          </div>

          <div v-if="showAnchor" class="lp-anchors">
            <span class="sp-label">锚点</span>
            <button
              v-for="a in ANCHORS"
              :key="a.v"
              class="btn small"
              :class="{ active: imageAnchor === a.v }"
              @click="setAnchor(a.v)"
            >
              {{ a.l }}
            </button>
          </div>

          <div v-if="!showMulti" class="lp-row">
            <button class="btn small" @click="chooseBgImage">
              {{ imageUrl ? '更换背景图' : '选择背景图' }}
            </button>
            <span v-if="imageName" class="muted lp-file" :title="imageName">{{ imageName }}</span>
          </div>

          <div v-else class="lp-multi">
            <div v-for="band in [
              { k: 'top', l: '页首图' },
              { k: 'bottom', l: '页尾图' }
            ]" :key="band.k" class="lp-row">
              <span class="sp-label lp-band">{{ band.l }}</span>
              <button class="btn small" @click="pickMulti(band.k as 'top' | 'bottom')">选择</button>
              <button
                v-if="multi[band.k === 'top' ? 'topUrl' : 'bottomUrl']"
                class="btn small"
                @click="clearMulti(band.k as 'top' | 'bottom')"
              >
                清除
              </button>
            </div>
            <span class="sp-label">中间区域</span>
            <div class="lp-btns">
              <button
                v-for="mk in [
                  { v: 'image', l: '图片' },
                  { v: 'color', l: '纯色' },
                  { v: 'gradient', l: '渐变' }
                ]"
                :key="mk.v"
                class="btn small"
                :class="{ active: (multi.midKind ?? 'image') === mk.v }"
                @click="setMidKind(mk.v as 'image' | 'color' | 'gradient')"
              >
                {{ mk.l }}
              </button>
            </div>
            <template v-if="(multi.midKind ?? 'image') === 'image'">
              <div class="lp-row">
                <button class="btn small" @click="pickMulti('mid')">
                  {{ multi.midUrl ? '更换中间图' : '选择中间图' }}
                </button>
                <button v-if="multi.midUrl" class="btn small" @click="clearMulti('mid')">清除</button>
              </div>
              <div class="lp-fits lp-fits-sm">
                <button
                  v-for="f in MID_FITS"
                  :key="f.v"
                  class="lp-fit"
                  :class="{ on: (multi.midFit ?? 'fill') === f.v }"
                  :title="f.hint"
                  @click="setMidFit(f.v)"
                >
                  <BgFitIcon :fit="f.v" />
                  <span>{{ f.l }}</span>
                </button>
              </div>
              <div v-if="ANCHOR_FITS.includes(multi.midFit ?? 'fill')" class="lp-anchors">
                <span class="sp-label">锚点</span>
                <button
                  v-for="a in ANCHORS"
                  :key="a.v"
                  class="btn small"
                  :class="{ active: (multi.midAnchor ?? 'center') === a.v }"
                  @click="setMidAnchor(a.v)"
                >
                  {{ a.l }}
                </button>
              </div>
            </template>
            <div v-else-if="multi.midKind === 'color'" class="lp-row">
              <input
                :value="multi.midColor || '#ffffff'"
                type="color"
                class="tb-color"
                @input="setMidColor(($event.target as HTMLInputElement).value)"
              />
            </div>
            <div v-else class="lp-swatches">
              <button
                v-for="g in GRADIENTS"
                :key="g.value"
                class="lp-swatch"
                :class="{ on: multi.midGradient === g.value }"
                :style="{ background: g.value }"
                :title="g.label"
                @click="setMidGradient(g.value)"
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.layer-panel {
  border-top: 1px solid var(--border);
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.lp-scope,
.lp-active {
  font-size: 12px;
}

.lp-scope {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lp-active {
  margin: -6px 0 0;
}

.sp-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sp-group.disabled {
  opacity: 0.55;
}

.lp-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lp-btns .btn.active {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.lp-opacity {
  display: flex;
  align-items: center;
  gap: 10px;
}

.lp-opacity input {
  flex: 1;
}

.lp-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lp-file {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 11px;
}

.lp-band {
  width: 52px;
  flex-shrink: 0;
}

.lp-swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.lp-swatch {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  cursor: pointer;
}

.lp-swatch:hover,
.lp-swatch.on {
  border-color: var(--accent);
}

.lp-img-editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lp-fits {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
  gap: 8px;
}

.lp-fit {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface, #fff);
  color: var(--ink);
  font-size: 11px;
  cursor: pointer;
}

.lp-fit:hover {
  border-color: var(--accent);
}

.lp-fit.on {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}

.lp-fits-sm .lp-fit {
  padding: 6px 4px;
}

.lp-anchors {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.lp-multi {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px dashed var(--border-strong);
  border-radius: 8px;
}
</style>
