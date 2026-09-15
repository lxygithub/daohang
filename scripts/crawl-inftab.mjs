// 内置导航站点库抓取：inftab（Infinity 新标签页）公开图标库 API。
//   GET https://api.inftab.com/get-icons?lang=zh-CN&type=<cat>&page=<n>&version=11.0.41
//   * type=popular 为全量热度榜（34958 条），另 14 个内容分类各若干页（shareByUser 需登录态，弃用）
//   * 每页 50 条；字段 name/url/src(图标直链)/keyword/description/type[]/rate
//
// 用法：
//   node scripts/crawl-inftab.mjs crawl   # 分页抓原始数据（断点续爬，写 data/inftab-raw/<cat>.jsonl）
//   node scripts/crawl-inftab.mjs merge   # 清洗合并去重 → data/builtin-sites.json
// 状态目录：scripts/data/（不入库）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const RAW = path.join(DATA, 'inftab-raw')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0'
const API = 'https://api.inftab.com/get-icons?lang=zh-CN&version=11.0.41'
const CONCURRENCY = 6
const CATS = ['popular', 'app', 'news', 'music', 'photos', 'shopping', 'social', 'sports', 'life', 'games', 'education', 'tech', 'finance', 'read', 'others']
const KNOWN_CATS = new Set(CATS.filter(c => c !== 'popular'))
// 明确的追踪参数（其余查询参数保留，避免破坏功能性 URL）
const TRACK_RE = /^(utm_|fbclid$|gclid$|igshid$|spm$)/i

fs.mkdirSync(RAW, { recursive: true })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function fetchPage(cat, page, attempt = 0) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15000)
    const res = await fetch(`${API}&type=${cat}&page=${page}`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Referer': '' },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const d = await res.json()
    if (!d.success) throw new Error('success=false')
    return d
  } catch (e) {
    if (attempt >= 2) throw e
    await sleep(1500 * (attempt + 1))
    return fetchPage(cat, page, attempt + 1)
  }
}

// ---- 清洗 ----

function extractRealUrl(item) {
  let u = String(item.url || '').trim()
  let host = ''
  try { host = u ? new URL(u).hostname : '' } catch { }
  // inftab 推广/代理页 → 从 keyword 里捞真实网址
  if (!u || /inftab\.com$|infinity(new)?tab\.com$/i.test(host.replace(/^www\./, ''))) {
    const m = String(item.keyword || '').match(/https?:\/\/[^\s,'"\u3001\uff0c]+/i)
    if (m) u = m[0]
    else if (!u) return ''
  }
  return u.trim()
}

function cleanUrl(raw) {
  let d
  try { d = new URL(raw.includes('://') ? raw : 'https://' + raw) } catch { return null }
  if (!/^https?:$/.test(d.protocol) || !d.hostname.includes('.')) return null
  d.protocol = 'https:' // 统一 https（绝大多数站点 301 兼容；仅用于存储与去重）
  d.hash = ''
  for (const k of [...d.searchParams.keys()]) {
    if (TRACK_RE.test(k)) d.searchParams.delete(k)
  }
  d.hostname = d.hostname.toLowerCase()
  if (d.pathname.length > 1) d.pathname = d.pathname.replace(/\/+$/, '')
  return d.href
}

function dedupKey(u) {
  // 更宽松的键：强制 https、忽略 www. 前缀差异 —— http/https、www/裸域 视为同一站点
  try {
    const d = new URL(u)
    const host = d.hostname.replace(/^www\./, '')
    const qs = [...d.searchParams.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&')
    return host + d.pathname.replace(/\/$/, '') + (qs ? '?' + qs : '')
  } catch { return u }
}

function cleanItem(item, cat) {
  const url = cleanUrl(extractRealUrl(item))
  if (!url) return null
  const name = String(item.name || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!name) return null
  const desc = String(item.description || item.descrption || '').trim().replace(/\s+/g, ' ').slice(0, 200)
  const src = String(item.src || '').trim()
  const iconSrc = /^https?:\/\//.test(src) ? src : ''
  const rate = Math.max(0, parseInt(item.rate, 10) || 0)
  const types = Array.isArray(item.type) ? item.type : []
  const cats = types.map(t => String(t).trim()).filter(Boolean).map(t => KNOWN_CATS.has(t) ? t : 'others')
  return { url, key: dedupKey(url), name, desc, iconSrc, rate, sourceId: String(item._id || ''), cats }
}

// ---- crawl 子命令：分页抓取，断点续爬 ----

async function crawl() {
  const progFile = path.join(DATA, 'inftab-progress.json')
  let progress = {}
  if (fs.existsSync(progFile)) {
    try { progress = JSON.parse(fs.readFileSync(progFile, 'utf8')) } catch { progress = {} }
  }
  for (const cat of CATS) {
    const file = path.join(RAW, cat + '.jsonl')
    const done = progress[cat] ?? -1 // 已抓完的最后一页
    // 探测总页数
    const first = await fetchPage(cat, 0)
    const totalPages = Math.min(first.totalPages || 1, 800)
    console.log(`[${cat}] count=${first.count} pages=${totalPages} 已完成页=${done + 1}`)
    const fh = fs.openSync(file, 'a')
    let fetched = done
    // 从未抓过的页并发抓取
    const pages = []
    for (let p = done + 1; p < totalPages; p++) pages.push(p)
    let idx = 0, saved = 0
    async function worker() {
      while (idx < pages.length) {
        const p = pages[idx++]
        try {
          const d = await fetchPage(cat, p)
          const lines = (d.icons || []).map(i => JSON.stringify({ _p: p, cat, item: i }))
          if (lines.length) fs.writeFileSync(fh, lines.join('\n') + '\n')
          fetched = Math.max(fetched, p)
          saved += lines.length
        } catch (e) {
          console.log(`[${cat}] page ${p} 失败（跳过，重跑可补）: ${e.message}`)
        }
        if ((idx & 15) === 0) { progress[cat] = fetched; fs.writeFileSync(path.join(DATA, 'inftab-progress.json'), JSON.stringify(progress)) }
        await sleep(60)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    progress[cat] = totalPages - 1
    fs.writeFileSync(path.join(DATA, 'inftab-progress.json'), JSON.stringify(progress))
    fs.closeSync(fh)
    console.log(`[${cat}] 本轮新增 ${saved} 条 → ${file}`)
  }
  console.log('crawl 完成')
}

// ---- merge 子命令：清洗 + 按 dedupKey 去重合并 ----

async function merge() {
  const byKey = new Map()
  let rawCount = 0
  for (const cat of CATS) {
    const file = path.join(RAW, cat + '.jsonl')
    if (!fs.existsSync(file)) continue
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      let rec
      try { rec = JSON.parse(line) } catch { continue }
      const c = cleanItem(rec.item, rec.cat)
      if (!c) continue
      rawCount++
      const prev = byKey.get(c.key)
      if (!prev) { byKey.set(c.key, c); continue }
      // 合并：取热度高者为主体，分类并集，名称/描述留更全的
      prev.cats = [...new Set([...prev.cats, ...c.cats])]
      if (c.rate > prev.rate) {
        prev.rate = c.rate
        prev.sourceId = c.sourceId
        if (c.iconSrc) prev.iconSrc = c.iconSrc
        if (c.name.length > prev.name.length && !/[a-z]/.test(c.name[0])) prev.name = c.name
      }
      if (!prev.desc && c.desc) prev.desc = c.desc
      if (!prev.iconSrc && c.iconSrc) prev.iconSrc = c.iconSrc
    }
  }
  const sites = [...byKey.values()].map(c => ({
    url: c.url, name: c.name, icon: '', iconSrc: c.iconSrc,
    description: c.desc, rate: c.rate, sourceId: c.sourceId, cats: c.cats,
  }))
  sites.sort((a, b) => b.rate - a.rate)
  fs.writeFileSync(path.join(DATA, 'builtin-sites.json'), JSON.stringify(sites))
  const withIcon = sites.filter(s => s.iconSrc).length
  const withDesc = sites.filter(s => s.description).length
  const withCats = sites.filter(s => s.cats.length).length
  console.log(`原始 ${rawCount} 条 → 去重后 ${sites.length} 站点`)
  console.log(`带图标源 ${withIcon}（${Math.round(withIcon / sites.length * 100)}%）｜带描述 ${withDesc}｜有分类 ${withCats}`)
  const catStat = {}
  for (const s of sites) for (const c of s.cats) catStat[c] = (catStat[c] || 0) + 1
  console.log('分类分布:', JSON.stringify(catStat))
}

const cmd = process.argv[2] || ''
if (cmd === 'crawl') await crawl()
else if (cmd === 'merge') await merge()
else { console.log('用法: node scripts/crawl-inftab.mjs crawl|merge'); process.exit(1) }
