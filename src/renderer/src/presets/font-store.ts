import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { SystemFont } from '@shared/types'
import { api } from '../api'
import { FONT_LABELS, FONT_OPTIONS } from './preset-service'

export interface FontGroup {
  name: string
  items: SystemFont[]
}

/** 内置推荐字体排在系统字体之前；系统列表加载失败时退化为它 */
const FALLBACK: SystemFont[] = FONT_OPTIONS.map((family) => ({
  family,
  label: FONT_LABELS[family] ?? family
}))

const systemFonts = ref<SystemFont[]>(FALLBACK)
const loading = ref(false)
let requested = false

/** 字体家族 → 中文名（系统字体自带 label，其次内置映射，最后原名） */
export function fontLabel(family: string): string {
  const hit = systemFonts.value.find((f) => f.family === family)
  return hit?.label ?? FONT_LABELS[family] ?? family
}

export function useSystemFonts(): {
  fonts: Ref<SystemFont[]>
  groups: ComputedRef<FontGroup[]>
  loading: Ref<boolean>
} {
  if (!requested) {
    requested = true
    loading.value = true
    void api.fonts
      .list()
      .then((list) => {
        if (list.length) systemFonts.value = list
      })
      .catch(() => {
        /* 拿不到系统字体就用推荐列表 */
      })
      .finally(() => {
        loading.value = false
      })
  }
  return { fonts: systemFonts, groups: fontGroups, loading }
}

const fontGroups = computed(() => {
  const all = systemFonts.value
  const preferred = all.filter((f) => FONT_OPTIONS.includes(f.family))
  const rest = all.filter((f) => !FONT_OPTIONS.includes(f.family))
  const groups: { name: string; items: SystemFont[] }[] = []
  if (preferred.length) groups.push({ name: '推荐', items: preferred })
  if (rest.length) groups.push({ name: `本机字体（${rest.length}）`, items: rest })
  return groups
})
