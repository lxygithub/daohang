// daohang service worker
// - hashed /assets/: cache-first
// - navigation & static files: network-first with cache fallback (offline support)
// - /api/: always network (never cached)
const CACHE = 'daohang-v3'
const IMG_CACHE = 'daohang-img-v1'
const PRECACHE = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // 图片（壁纸、站点图标——含跨域的自家图床）走 cache-first：壁纸是大图，
  // 每次开首页都重新下载的话，背景会空一会儿；缓存后二次访问直接命中。
  if (req.destination === 'image') {
    e.respondWith(
      caches.open(IMG_CACHE).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req)
              .then((res) => {
                if (res.ok || res.type === 'opaque') c.put(req, res.clone())
                return res
              })
              .catch(() => hit)
        )
      )
    )
    return
  }

  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return // never cache API

  // Hashed build assets: cache-first
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
            return res
          })
      )
    )
    return
  }

  // Everything else (SPA navigation, icons, manifest): network-first
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone()
        caches.open(CACHE).then((c) => c.put(req, copy))
        return res
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || caches.match('/'))
      )
  )
})
