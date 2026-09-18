// 站点图标统一走自家代理 /api/icon（同源 + 边缘缓存），见 functions/api/icon.js。
// 只对自家图床的外链做改写，其它外链原样返回。
const PROXY_HOSTS = new Set(['img-bed.ieoc.top'])

export function iconSrc(url) {
  if (!url || typeof url !== 'string') return url
  if (!url.startsWith('https://')) return url
  try {
    const u = new URL(url)
    if (!PROXY_HOSTS.has(u.hostname)) return url
    return `/api/icon?u=${encodeURIComponent(url)}`
  } catch {
    return url
  }
}
