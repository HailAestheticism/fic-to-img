import type { DocLayout, Typography } from './types'

/** H0（文档标题）字号缩放的缺省值：旧文档与旧预设未存 h0Scale 时按此回退 */
export const DEFAULT_H0_SCALE = 2.2

export function h0ScaleOf(t: Pick<Typography, 'h0Scale' | 'bodySize'>): number {
  const s = t.h0Scale
  return typeof s === 'number' && isFinite(s) && s > 0 ? s : DEFAULT_H0_SCALE
}

export function defaultTypography(): Typography {
  return {
    bodyFont: 'Microsoft YaHei',
    bodySize: 16,
    bodyLineHeight: '1.9',
    bodyColor: '#2f2a26',
    headingFont: 'Microsoft YaHei',
    headingColor: '#2f2a26',
    h0Scale: DEFAULT_H0_SCALE,
    h1Scale: 1.7,
    h2Scale: 1.4,
    h3Scale: 1.2,
    quoteColor: '#5c554d'
  }
}

export function defaultLayout(): DocLayout {
  return {
    version: 1,
    pageSetup: {
      widthMm: 210,
      heightMm: 297,
      infiniteHeight: false,
      landscape: false,
      marginTopMm: 25,
      marginRightMm: 18,
      marginBottomMm: 22,
      marginLeftMm: 20,
      header: { enabled: false, text: '', align: 'center', fontSize: 9 },
      footer: {
        enabled: true,
        text: '',
        align: 'center',
        fontSize: 9,
        showPageNumber: true,
        pageNumberFormat: '{page} / {total}',
        pageNumberAlign: 'center'
      }
    },
    chapters: {},
    splitRules: { h1: false, regex: false, pattern: '' },
    typography: defaultTypography(),
    backgrounds: { global: null, chapter: {}, page: {} },
    freeElements: []
  }
}
