<script setup lang="ts">
import { computed, ref } from 'vue'
import { getToken, setToken } from '../token'
import { health, pollOnce } from '../sync'
import { store, showToast } from '../store'
import ScopeDialog from '../components/ScopeDialog.vue'

const tokenDraft = ref(getToken())
const showScope = ref(false)
const origin = window.location.origin
const standalone = computed(() => window.matchMedia('(display-mode: standalone)').matches)

function saveToken(): void {
  setToken(tokenDraft.value)
  showToast(tokenDraft.value.trim() ? '口令已保存' : '口令已清空')
  void pollOnce()
}

async function testConn(): Promise<void> {
  try {
    const r = await health()
    store.pcOnline = true
    store.pcError = ''
    showToast(`已连上电脑（${r.name} v${r.version}）`)
  } catch (e) {
    store.pcOnline = false
    store.pcError = e instanceof Error ? e.message : String(e)
    showToast(`连不上：${store.pcError}`)
  }
}

function fmtRecv(n: number): string {
  return new Date(n).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="yp">
    <header class="yp-head">
      <button class="yp-back" title="返回" @click="store.view = 'list'">←</button>
      <h1>同步</h1>
    </header>

    <div class="yp-scroll">
      <section class="yp-card">
        <div class="yp-row">
          <span class="yp-label">电脑地址</span>
          <code class="yp-addr">{{ origin }}</code>
        </div>
        <div class="yp-row">
          <span class="yp-label">状态</span>
          <span class="yp-state" :class="{ on: store.pcOnline === true, off: store.pcOnline === false }">
            {{ store.pcOnline === true ? '电脑在线，自动收取中' : store.pcOnline === false ? '电脑离线/连不上' : '等待探测…' }}
          </span>
        </div>
        <p v-if="store.pcError" class="yp-err">{{ store.pcError }}</p>
        <p class="yp-hint">电脑推送的文档会在打开 App 时自动收取；同步是单向覆盖——由发起方内容覆盖接收方。</p>
        <div class="yp-actions">
          <button class="yp-btn" @click="testConn">测试连接</button>
          <button class="yp-btn primary" @click="showScope = true">同步到电脑…</button>
        </div>
        <p v-if="store.lastRecvAt" class="yp-hint">上次收到电脑端文档：{{ fmtRecv(store.lastRecvAt) }}</p>
      </section>

      <section class="yp-card">
        <p class="yp-sec">电脑端口令</p>
        <input v-model="tokenDraft" class="yp-input" type="text" placeholder="电脑端「移动端同步」面板里显示的口令" @change="saveToken" />
        <p class="yp-hint">一般从电脑端地址打开本页时会自动带上，无需手填；换口令后才需要更新。</p>
      </section>

      <section v-if="!standalone" class="yp-card">
        <p class="yp-sec">安装到主屏幕（一次性）</p>
        <ol class="yp-steps">
          <li>用手机浏览器打开电脑端给的 HTTP 地址，下载 CA 证书并在系统设置里安装（安卓：设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书）。</li>
          <li>再打开 HTTPS 地址（地址栏无警示）。</li>
          <li>浏览器菜单 → 「添加到主屏幕」。</li>
          <li>以后点主屏幕图标即可离线编辑，不必开着电脑。</li>
        </ol>
      </section>
    </div>

    <ScopeDialog v-if="showScope" @close="showScope = false" />
  </div>
</template>

<style scoped>
.yp {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
}

.yp-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: calc(8px + env(safe-area-inset-top)) 12px 4px;
}

.yp-back {
  width: 40px;
  height: 40px;
  border: none;
  background: none;
  font-size: 22px;
  color: #3f8f5f;
}

.yp-head h1 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.yp-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px calc(24px + env(safe-area-inset-bottom));
}

.yp-card {
  background: #f7f8f8;
  border-radius: 14px;
  padding: 14px 16px;
  margin-top: 10px;
}

.yp-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 4px 0;
}

.yp-label {
  font-size: 13px;
  color: #8a908c;
  flex-shrink: 0;
}

.yp-addr {
  font-size: 12px;
  color: #2b2e2d;
  word-break: break-all;
  font-family: Consolas, monospace;
}

.yp-state {
  font-size: 13px;
  color: #a5aaa7;
}

.yp-state.on {
  color: #3f8f5f;
}

.yp-state.off {
  color: #c25a4a;
}

.yp-err {
  margin: 4px 0 0;
  font-size: 12px;
  color: #b4441f;
  line-height: 1.6;
}

.yp-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: #a5aaa7;
}

.yp-sec {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
}

.yp-actions {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.yp-btn {
  flex: 1;
  height: 42px;
  border-radius: 12px;
  border: 1px solid #e3e6e4;
  background: #fff;
  font-size: 14px;
  color: #1d1f1e;
}

.yp-btn.primary {
  background: #3f8f5f;
  border-color: #3f8f5f;
  color: #fff;
}

.yp-input {
  width: 100%;
  height: 40px;
  border: 1px solid #e3e6e4;
  border-radius: 10px;
  padding: 0 12px;
  font-size: 14px;
  background: #fff;
  outline: none;
}

.yp-steps {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.8;
  color: #8a908c;
}
</style>
