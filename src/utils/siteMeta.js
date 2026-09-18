// 站点元信息（标题/图标）客户端获取工具。
// 背景：/api/meta 在 Cloudflare 边缘抓取，存在两个盲区：
// 1) 内网地址（192.168.x.x / nas.local 等）边缘根本无法访问 → 需浏览器直连探测
// 2) 目标站屏蔽机房 IP（403 反爬）→ 浏览器带 Cookie 直连往往可行，作二次兜底

export function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "")
  if (!h) return false
  if (h === "localhost" || h.endsWith(".localhost")) return true
  if (/\.(local|lan|home|internal|localdomain|arpa)$/.test(h)) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT（Tailscale 等）
  }
  if (h === "::1" || /^(f[cd]|fe80)/.test(h)) return true
  return false
}

// 规范化用户输入的站点地址：
// - 已带协议 → 原样解析
// - 裸地址 → 内网默认 http://（内网服务几乎都是 http），公网默认 https://
export function normalizeSiteUrl(input) {
  const u = String(input || "").trim()
  if (!u) return ""
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
    try { return new URL(u).href } catch { return "" }
  }
  let hostname = ""
  try { hostname = new URL("https://" + u).hostname } catch { return "" }
  const scheme = isPrivateHost(hostname) ? "http://" : "https://"
  try { return new URL(scheme + u).href } catch { return "" }
}

// HTTPS 页面加载 HTTP 资源会被浏览器混合内容策略拦截（自动升级 https 后失败）
export function mixedContentBlocked(siteUrl) {
  return typeof location !== "undefined" &&
    location.protocol === "https:" &&
    /^http:\/\//i.test(siteUrl)
}

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] || m)
}

export function extractTitle(html) {
  if (!html) return ""
  const og =
    html.match(/<meta[^>]+property=["'](?:og:title|twitter:title)["'][^>]*\scontent=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+\scontent=["']([^"']+)["'][^>]*property=["'](?:og:title|twitter:title)["']/i)
  let t = og ? og[1] : ""
  if (!t) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (m) t = m[1]
  }
  if (!t) return ""
  return decodeEntities(t.replace(/\s+/g, " ").trim()).slice(0, 60)
}

function extractFirstIcon(html, baseUrl) {
  const candidates = []
  const linkRe = /<link\b[^>]*>/gi
  let m
  while ((m = linkRe.exec(html)) !== null) {
    const relM = m[0].match(/\srel=["']([^"']+)["']/i)
    const hrefM = m[0].match(/\shref=["']([^"']+)["']/i)
    if (!relM || !hrefM) continue
    const rel = relM[1].toLowerCase()
    if (/(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel)) candidates.unshift(hrefM[1])
    else if (rel.includes("apple-touch-icon")) candidates.push(hrefM[1])
  }
  for (const raw of candidates) {
    try {
      const full = new URL(decodeEntities(raw), baseUrl).href
      if (/^(https?:|data:image\/)/i.test(full)) return full
    } catch {}
  }
  return ""
}

// Image 探测：<img> 加载不受 CORS 限制；200 但返回 HTML 错误页时解码失败也会正确判负
export function probeIcon(url, timeout = 2500) {
  return new Promise((resolve) => {
    const img = new Image()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(t)
      resolve(ok ? url : null)
    }
    const t = setTimeout(() => finish(false), timeout)
    img.onload = () => finish(img.naturalWidth > 0)
    img.onerror = () => finish(false)
    img.referrerPolicy = "no-referrer"
    img.src = url
  })
}

// 客户端抓取站点 HTML（受目标 CORS 限制，拿不到则返回 null）
async function fetchClientHtml(siteUrl, timeout = 4000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeout)
    const res = await fetch(siteUrl, { signal: ctrl.signal, redirect: "follow" })
    clearTimeout(t)
    if (!res.ok) return null
    const ct = (res.headers.get("Content-Type") || "").toLowerCase()
    if (ct && !ct.includes("html") && !ct.includes("xml") && !ct.includes("text")) return null
    const html = await res.text()
    return html || null
  } catch {
    return null
  }
}

// 内网页面标题受 CORS 限制通常读不到（目标服务不带 Access-Control-Allow-Origin），
// 图标却总能拿到（<img> 不受限制）——为避免名称栏空着，按端口推测常见自托管服务名，
// 推测不出则用「地址[:端口]」兜底。均为预填，用户可改。
const LAN_PORT_NAMES = {
  5000: '群晖 DSM',
  5001: '群晖 DSM',
  8096: 'Jellyfin/Emby',
  32400: 'Plex',
  8123: 'Home Assistant',
  9091: 'Transmission',
  5244: 'Alist',
  9090: 'Cockpit',
}

export function guessLanName(siteUrl) {
  let u
  try { u = new URL(siteUrl) } catch { return '' }
  const port = u.port ? Number(u.port) : (/^https:/i.test(u.protocol) ? 443 : 80)
  if (LAN_PORT_NAMES[port]) return LAN_PORT_NAMES[port]
  const isDefault = (u.protocol === 'https:' && port === 443) || (u.protocol === 'http:' && port === 80)
  return isDefault ? u.hostname : `${u.hostname}:${u.port}`
}

// 内网服务：浏览器直连拿标题 + 图标。
// 1) fetch HTML（CORS 视服务而定，拿到则标题+图标一起返回）
// 2) Image 探测常见 favicon 路径（不受 CORS 限制，多数内网服务可命中）
export async function lanAutoFill(siteUrl) {
  const out = { title: "", icon: "" }
  const html = await fetchClientHtml(siteUrl)
  if (html) {
    out.title = extractTitle(html)
    out.icon = extractFirstIcon(html, siteUrl)
  }
  if (!out.icon) {
    const paths = ["/favicon.ico", "/favicon.png", "/favicon.svg", "/apple-touch-icon.png"]
    const hits = await Promise.all(
      paths.map((p) => {
        try { return probeIcon(new URL(p, siteUrl).href) } catch { return Promise.resolve(null) }
      })
    )
    out.icon = hits.find(Boolean) || ""
  }
  return out
}

// 注意：**公网站点的图标一律由 Worker 侧的 /api/meta 负责**（内置站点库 → 站点自身 →
// 多个公共图标服务 → 转存到自建图床），浏览器端不再发任何公网图标请求。原因：
//   1) 公共图标服务在国内不可达，浏览器直连只会拿到坏链接；
//   2) 浏览器拿到的必然是目标站自己的链接，站点被墙时首页照样是破图（不经图床就没法救）；
//   3) 用户浏览器可能开着代理、也可能没有，行为不可控，排查困难。
// 只有内网地址（lanAutoFill）必须由浏览器直连——Worker 在公网，够不到 192.168.x.x。
