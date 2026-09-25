import { createApp } from 'vue'
import App from './App.vue'
import { captureTokenFromUrl, startPolling } from './sync'
import { initStore } from './store'

captureTokenFromUrl()
initStore()
  .then(() => startPolling())
  .catch((e) => console.error('[mobile] 本地库初始化失败', e))

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* 非安全上下文（未装证书且未加旗标）或暂不可达时静默降级为普通网页 */
  })
}

createApp(App).mount('#app')
