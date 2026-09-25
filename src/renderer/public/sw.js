/* 手机端 PWA Service Worker：
   - /api/* 永不缓存（同步数据必须实时）；
   - 页面导航 network-first（在线时拿最新壳并续缓存，离线回退缓存壳）；
   - 带 hash 的静态资源 cache-first + 后台更新。 */
const CACHE = 'lfm-shell-v2'
const PRECACHE = ['/', '/mobile.html', '/mobile-icon-1024.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req)
          if (res.ok) {
            const cache = await caches.open(CACHE)
            cache.put('/mobile.html', res.clone())
          }
          return res
        } catch {
          const cache = await caches.open(CACHE)
          return (await cache.match('/mobile.html')) || (await cache.match('/')) || Response.error()
        }
      })()
    )
    return
  }

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      const cached = await cache.match(req)
      if (cached) {
        fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone())
          })
          .catch(() => {})
        return cached
      }
      try {
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      } catch {
        return Response.error()
      }
    })()
  )
})
