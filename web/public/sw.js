// ForgotIt Service Worker —— 只为「装到手机上像 App」服务：缓存 App 壳（静态资源）
// 让二次打开不必重新下载几百 KB 的 JS/CSS，断网也能看到壳。
//
// 刻意不缓存 /api/*：数据由应用自身的本地快照（home-cache / IndexedDB）负责，
// 在 SW 里再缓存一层会让「改完看不到变化」这类问题变得难以排查。
const VERSION = 'forgotit-v1'
const CACHE = `shell-${VERSION}`
const STATIC_RE = /\.(?:js|css|woff2?|png|jpg|jpeg|gif|svg|webp|ico|json|webmanifest)$/i

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('shell-') && key !== CACHE) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return // 数据一律走网络（应用自己管缓存）

  // 静态资源：缓存优先（Next 的 /_next/static 带内容哈希，可长期复用）
  if (url.pathname.startsWith('/_next/static/') || STATIC_RE.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE)
        const hit = await cache.match(request)
        if (hit) return hit
        const res = await fetch(request)
        if (res.ok && res.type === 'basic') cache.put(request, res.clone())
        return res
      })(),
    )
    return
  }

  // 页面导航：网络优先（保证拿得到新版本），失败回退缓存（离线也能打开）
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          const cache = await caches.open(CACHE)
          cache.put(request, res.clone())
          return res
        } catch {
          const cache = await caches.open(CACHE)
          return (await cache.match(request)) || (await cache.match('/')) || Response.error()
        }
      })(),
    )
  }
})
