const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const outMain = path.join(root, 'out', 'main', 'index.js')
const outRendererIndex = path.join(root, 'out', 'renderer', 'index.html')
const isWin = process.platform === 'win32'

function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

function newestFile(dir, skip) {
  let max = 0
  const walk = (d, depth) => {
    if (depth > 6) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (/\.(ts|vue|css|html|json)$/.test(e.name)) max = Math.max(max, mtime(full))
    }
  }
  if (fs.existsSync(dir)) walk(dir, 0)
  for (const f of skip) max = Math.max(max, mtime(path.join(root, f)))
  return max
}

function needsBuild() {
  const built = Math.min(mtime(outMain), mtime(outRendererIndex))
  if (!built) return true
  return newestFile(path.join(root, 'src'), ['package.json', 'electron.vite.config.ts', 'index.html']) > built
}

function runTool(args) {
  const bin = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
  return spawnSync(process.execPath, [bin, ...args], { cwd: root, stdio: 'inherit' }).status ?? 1
}

function runBuild() {
  console.log('源码有更新，先构建（约 15 秒）…')
  return runTool(['build']) === 0
}

function readMobileConfig() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, 'data', 'settings.json'), 'utf8'))
    return s.mobile || null
  } catch {
    return null
  }
}

function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    sock.setTimeout(600)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('error', () => resolve(false))
  })
}

function printMobileHint(cfg) {
  if (!cfg || !cfg.enabled) {
    console.log('手机端写作：未开启。进应用点顶栏「手机写作」打开局域网服务。')
    return
  }
  const os = require('node:os')
  const ips = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const info of list || []) if (info.family === 'IPv4' && !info.internal) ips.push(info.address)
  }
  console.log(`手机端写作已开启，手机浏览器打开：${ips.map((ip) => `http://${ip}:${cfg.port}/?t=${cfg.token}`).join('  或  ') || '（未取到局域网 IP，进应用看地址）'}`)
}

async function launchBuilt() {
  if (needsBuild() && !runBuild()) {
    console.error('构建失败，先跑 npm run typecheck 看报错。')
    process.exitCode = 1
    return
  }
  const out = fs.openSync(path.join(root, '.preview.log'), 'a')
  const err = fs.openSync(path.join(root, '.preview.err.log'), 'a')
  const child = spawn(electronExe, [outMain], { cwd: root, detached: true, stdio: ['ignore', out, err] })
  child.unref()
  console.log(`预览已启动（进程 ${child.pid}），窗口标题「文转条图」。`)
  printMobileHint(readMobileConfig())
  console.log('日志：.preview.log / .preview.err.log；关掉应用窗口即结束，重复双击会再开一个窗口。')
}

function launchDev() {
  console.log('开发模式（改渲染层代码即时生效，改主进程会自动重启）…')
  process.exitCode = runTool(['dev'])
}

async function main() {
  const cfg = readMobileConfig()
  const busy = cfg && cfg.enabled ? await portInUse(cfg.port) : false
  if (process.argv.includes('--status')) {
    console.log(`需要构建：${needsBuild() ? '是（src 比 out/ 新）' : '否（out/ 已是最新）'}`)
    console.log(`已有实例：${busy ? `是（${cfg.port} 端口在监听）` : '否'}`)
    printMobileHint(cfg)
    return
  }
  if (busy) {
    console.log(`检测到 ${cfg.port} 端口已有实例在跑，可能预览窗口已经开着（看任务栏「文转条图」）。`)
    console.log('仍要再开一个窗口就继续；想干净重启：任务管理器结束 electron.exe，或 PowerShell 跑 Stop-Process -Name electron -Force')
  }
  if (process.argv.includes('--dev')) return launchDev()
  await launchBuilt()
}

void main()
