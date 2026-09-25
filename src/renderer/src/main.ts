import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import ExportSurface from './export/ExportSurface.vue'
import './styles/global.css'

// 阶段 50 改名：偏好键前缀 longform. → fictoimg.，首帧前把旧值搬过去（旧键保留，方便回退旧版）
for (const key of Object.keys(localStorage)) {
  if (!key.startsWith('longform.')) continue
  const next = `fictoimg.${key.slice('longform.'.length)}`
  if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key) as string)
}

// 导出模式：offscreen 窗口只挂载导出面，不加载整个应用
if (new URLSearchParams(location.search).get('export') === '1') {
  createApp(ExportSurface).mount('#app')
} else {
  createApp(App).use(createPinia()).mount('#app')
}
