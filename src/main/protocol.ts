import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { getDataDir } from './storage'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 预设资源主机名：appres://preset/assets/<file>，与文档资源同协议但不同目录 */
const PRESET_HOST = 'preset'

/**
 * appres://<docId>/assets/<file> 与 appres://preset/assets/<file>
 * —— 文档主机名必须是 UUID，路径不得越出该文档目录；预设主机名只开放 assets 子目录。
 */
export function registerResourceProtocol(): void {
  protocol.handle('appres', async (request) => {
    try {
      const url = new URL(request.url)
      const host = url.hostname
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      let base: string
      if (host === PRESET_HOST) {
        if (!rel.startsWith('assets/')) return new Response('forbidden', { status: 403 })
        base = normalize(join(getDataDir(), 'presets'))
      } else if (UUID_RE.test(host)) {
        base = normalize(join(getDataDir(), 'documents', host))
      } else {
        return new Response('invalid doc id', { status: 400 })
      }
      const file = normalize(join(base, rel))
      if (!file.startsWith(base + sep)) {
        return new Response('forbidden', { status: 403 })
      }
      const buf = await readFile(file)
      const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(buf), {
        headers: {
          'content-type': type,
          'cache-control': 'no-cache',
          'access-control-allow-origin': '*'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
