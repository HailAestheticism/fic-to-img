<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { MobileStatus } from '@shared/types'
import { api } from '../../api'
import Modal from '../common/Modal.vue'
import SyncToPhoneDialog from './SyncToPhoneDialog.vue'

const emit = defineEmits<{ (e: 'close'): void }>()

const status = ref<MobileStatus | null>(null)
const busy = ref(false)
const copied = ref('')
const portText = ref('')
const showSync = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

async function refresh(next?: MobileStatus): Promise<void> {
  status.value = next ?? (await api.mobile.status())
  portText.value = String(status.value.port)
}

onMounted(() => {
  void refresh()
  timer = setInterval(() => void refresh(), 4000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

async function run(fn: () => Promise<MobileStatus>): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await refresh(await fn())
  } finally {
    busy.value = false
  }
}

function toggle(): void {
  void run(() => api.mobile.setEnabled(!status.value?.enabled))
}

function applyPort(): void {
  const port = Number(portText.value)
  if (!Number.isFinite(port)) {
    void refresh()
    return
  }
  void run(() => api.mobile.setPort(port))
}

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => (copied.value = ''), 1600)
  } catch {
    copied.value = ''
  }
}

function phoneState(): string {
  const s = status.value
  if (!s) return ''
  if (!s.running) return '服务未开启'
  if (!s.phoneLastSeen) return '手机还没有连接过'
  const ago = Date.now() - s.phoneLastSeen
  if (ago < 20_000) return '手机在线'
  return `手机最近在线：${new Date(s.phoneLastSeen).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}
</script>

<template>
  <Modal title="移动端同步" wide @close="emit('close')">
    <div class="mp-row">
      <div>
        <strong>局域网服务</strong>
        <p class="muted">手机通过主屏幕上的「文转条图」离线写作，回到同一 Wi-Fi 后与电脑双向同步。同步是单向覆盖：由发起方把内容推给接收方。</p>
      </div>
      <button class="btn" :class="{ primary: status?.enabled }" :disabled="busy" @click="toggle">
        {{ status?.enabled ? '已开启' : '已关闭' }}
      </button>
    </div>

    <p v-if="status?.error" class="mp-error">{{ status.error }}</p>

    <div v-if="status?.running" class="mp-cols">
      <div class="mp-col">
        <p class="mp-sec">首次安装（手机浏览器操作一次）</p>
        <ol class="mp-steps">
          <li>手机浏览器打开 HTTP 地址，下载并安装 <b>CA 证书</b>（安卓：设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书）。</li>
          <li>打开 HTTPS 地址，菜单里选「添加到主屏幕」。</li>
          <li>以后点主屏幕图标即可离线使用，无需电脑开着。</li>
        </ol>
        <div v-for="u in status.caUrls" :key="'ca' + u" class="mp-url">
          <code>证书下载：{{ u }}</code>
          <button class="btn small" @click="void copy(u)">{{ copied === u ? '已复制' : '复制' }}</button>
        </div>
        <div v-for="u in status.urls" :key="'h' + u" class="mp-url">
          <code>{{ u }}</code>
          <button class="btn small" @click="void copy(u)">{{ copied === u ? '已复制' : '复制' }}</button>
        </div>
        <div v-for="u in status.httpsUrls" :key="'s' + u" class="mp-url">
          <code>{{ u }}（装证书后使用）</code>
          <button class="btn small" @click="void copy(u)">{{ copied === u ? '已复制' : '复制' }}</button>
        </div>
        <p v-if="!status.urls.length" class="muted">没有检测到局域网网卡，请确认电脑已连接 Wi-Fi 或网线。</p>
      </div>

      <div class="mp-col">
        <div class="mp-state">{{ phoneState() }}<span v-if="status.pendingCount"> · 待手机收取 {{ status.pendingCount }} 篇</span></div>
        <label class="mp-field">
          <span>端口</span>
          <input v-model="portText" class="input" type="number" min="1024" max="65535" @change="applyPort" />
          <button class="btn small" :disabled="busy" @click="void run(() => api.mobile.rotateToken())">重新生成口令</button>
        </label>
        <button class="btn primary mp-sync-btn" @click="showSync = true">同步文档到手机…</button>
        <p class="muted mp-note">首次监听时 Windows 防火墙可能弹窗，请对「专用网络」选择允许。</p>
        <p class="muted mp-note">同步范围在弹窗里选择（当前打开文档 / 选择文档 / 全部文档）；电脑推给手机的内容会暂存，手机打开 App 后自动收取并回执。</p>
      </div>
    </div>

    <template #footer>
      <button class="btn" @click="emit('close')">关闭</button>
    </template>
  </Modal>

  <SyncToPhoneDialog v-if="showSync" @close="showSync = false" />
</template>

<style scoped>
.mp-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  font-size: 13px;
}

.mp-row p {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.7;
}

/* 说明文字占满剩余宽度时别把开关按钮挤到换行（「已开启」曾被压成两行） */
.mp-row > div {
  min-width: 0;
}

.mp-row > .btn {
  flex: none;
  white-space: nowrap;
}

.mp-error {
  margin: 10px 0 0;
  font-size: 12px;
  color: #b4441f;
}

.mp-cols {
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: start;
}

.mp-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mp-state {
  font-size: 12px;
  color: var(--ink);
  background: var(--panel-soft);
  border-radius: 6px;
  padding: 6px 9px;
}

.mp-sec {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}

.mp-steps {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.8;
  color: var(--muted);
}

.mp-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.mp-field input {
  width: 96px;
}

.mp-url {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-soft);
}

.mp-url code {
  font-size: 11px;
  word-break: break-all;
  font-family: Consolas, monospace;
}

.mp-url .btn {
  flex-shrink: 0;
  white-space: nowrap;
}

.mp-sync-btn {
  width: 100%;
}

.mp-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
}
</style>
