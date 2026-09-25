import { app, ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SystemFont } from '../shared/types'

/** 已知字体的中文名，与排版面板保持一致 */
const CN_NAMES: Record<string, string> = {
  'Microsoft YaHei': '微软雅黑',
  'Microsoft YaHei UI': '微软雅黑 UI',
  SimSun: '宋体',
  SimHei: '黑体',
  KaiTi: '楷体',
  FangSong: '仿宋',
  DengXian: '等线',
  STKaiti: '华文楷体',
  STSong: '华文中宋',
  STXihei: '华文中黑',
  YouYuan: '幼圆',
  LiSu: '隶书',
  NSimSun: '新宋体',
  Arial: 'Arial',
  Georgia: 'Georgia',
  'Times New Roman': 'Times New Roman',
  Consolas: 'Consolas'
}

const STYLE_WORDS =
  'Bold|Italic|Regular|Light|Thin|Medium|Semi|Extra|Ultra|Demi|Black|Heavy|Oblique'
const STYLE_TAIL = new RegExp(`^(.*?)\\b((?:${STYLE_WORDS})+)$`, 'i')
const CN_STYLE_TAIL = /^(.*?)([- ]?)(斜体|粗体|常规|标准|细体)$/

/** 注册表里的键名常带字重后缀，还原成 CSS 可用的家族名 */
function stripStyle(name: string): { base: string; hard: boolean } {
  const cn = CN_STYLE_TAIL.exec(name)
  if (cn && cn[1].trim()) return { base: cn[1].trim(), hard: true }
  let base = name
  let hard = false
  for (let i = 0; i < 3; i++) {
    const m = STYLE_TAIL.exec(base)
    if (!m || !m[1].trim()) break
    if (base[base.length - m[2].length - 1] === '-') hard = true
    // 「霞鹜文楷 Regular」这类中文名 + 拉丁字重：家族名只取中文部分
    if (/[\u3400-\u9fff]/.test(m[1])) hard = true
    base = m[1].replace(/[- ]+$/, '').trim()
    if (!base) break
  }
  return { base, hard }
}

function parseRegFile(text: string): string[] {
  const names: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^"((?:[^"\\]|\\.)*)"\s*=(?:"|hex|@)/i.exec(line)
    if (!m) continue
    let name = m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"')
    name = name.replace(/\s*\((?:TrueType|OpenType|Type ?1|bitmap)[^)]*\)\s*$/i, '')
    // 「微软雅黑 & Microsoft YaHei UI」取第一个（本地化优先）
    name = name.split('&')[0].trim()
    if (name) names.push(name)
  }
  return names
}

function dedupe(names: string[]): string[] {
  const raw = new Set(names)
  const out = new Set<string>()
  for (const n of names) {
    const { base, hard } = stripStyle(n)
    if (!base) continue
    out.add(hard || raw.has(base) ? base : n)
  }
  return [...out].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

/** Windows：reg export 落地成 .reg 再读，避开控制台代码页对中文名的截断 */
async function windowsFontNames(): Promise<string[]> {
  const key = 'SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
  const hives = ['HKLM', 'HKCU']
  const all: string[] = []
  await Promise.all(
    hives.map(async (hive) => {
      const file = join(tmpdir(), `fictoimg-fonts-${randomUUID()}.reg`)
      try {
        await new Promise<void>((res, rej) => {
          execFile('reg', ['export', `${hive}\\${key}`, file, '/y'], { windowsHide: true }, (err) =>
            err ? rej(err) : res()
          )
        })
        const buf = await readFile(file)
        const text =
          buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le').slice(1) : buf.toString('latin1')
        all.push(...parseRegFile(text))
      } catch {
        /* 该 hive 可能不存在（如无用户字体） */
      } finally {
        void rm(file, { force: true })
      }
    })
  )
  return all
}

/** 其他系统：直接列字体目录，文件名即家族名（macOS 上通常足够准） */
async function dirFontNames(): Promise<string[]> {
  const dirs =
    process.platform === 'darwin'
      ? ['/System/Library/Fonts', '/Library/Fonts', join(app.getPath('home'), 'Library/Fonts')]
      : ['/usr/share/fonts', '/usr/local/share/fonts', join(app.getPath('home'), '.fonts')]
  const names: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 4) return
    let entries: string[] = []
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e)
      try {
        if ((await stat(full)).isDirectory()) await walk(full, depth + 1)
        else if (/\.(ttf|otf|ttc)$/i.test(e)) names.push(e.replace(/\.[a-z]+$/i, ''))
      } catch {
        /* 忽略无权限项 */
      }
    }
  }
  for (const d of dirs) await walk(d, 0)
  return names
}

let cache: SystemFont[] | null = null

export async function listSystemFonts(): Promise<SystemFont[]> {
  if (cache) return cache
  let names: string[] = []
  try {
    names = process.platform === 'win32' ? await windowsFontNames() : await dirFontNames()
  } catch {
    names = []
  }
  const families = dedupe(names)
  cache = families.map((family) => ({ family, label: CN_NAMES[family] ?? family }))
  return cache
}

export function registerFontsIpc(): void {
  ipcMain.handle('fonts:list', () => listSystemFonts())
}
