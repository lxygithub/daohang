// API 级测试：内置站点库 /api/builtin-sites（读）+ /api/builtin-sites/import（armed 写）
// 前置：wrangler pages dev（.dev.vars 含 BUILTIN_IMPORT_KEY）；本地 D1 自动建库
// 用法：node scripts/test-builtin.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE || 'http://127.0.0.1:8788'
const KEY = (fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars'), 'utf8')
  .split('\n').find(l => l.startsWith('BUILTIN_IMPORT_KEY=')) || '').split('=')[1]?.trim()

const jf = async (url, opts = {}) => {
  const res = await fetch(url, opts)
  const text = await res.text()
  try { return JSON.parse(text) } catch {
    throw new Error(`非JSON: ${url} → ${res.status} ${res.headers.get('content-type')} ${text.slice(0, 100)}`)
  }
}
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)) }
const S = (n) => Array.from({ length: n }, (_, i) => ({
  url: `https://example${i % 40}.com/page${i}`, name: `站点${i}`,
  icon: `https://img.test/${i}.png`, iconSrc: `https://src.test/${i}.png`,
  description: `描述${i}`, rate: 1000 - i, sourceId: `sid${i}`,
  cats: i % 2 ? ['app'] : ['games', '未知分类'], // 未知分类应被过滤
}))

// 1. 空库读 → ok 且 0 条
{
  const d = await jf(BASE + '/api/builtin-sites')
  ok(d.ok === true && d.total === 0 && Array.isArray(d.items), '空库读取 → ok, total=0')
  ok(Array.isArray(d.cats) && d.cats.includes('app'), '返回支持分类列表')
}

// 2. 未开通道/密钥错误
{
  const r = await fetch(BASE + '/api/builtin-sites/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: 'wrong', sites: S(1) }),
  })
  ok(r.status === 403, `密钥错误 → 403 (got ${r.status})`)
}
{
  const r = await fetch(BASE + '/api/builtin-sites/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not json' })
  ok([400, 403].includes(r.status), `无效请求 → 400/403 (got ${r.status})`)
}

// 3. 正常导入（带密钥）→ accepted + total
{
  const r = await fetch(BASE + '/api/builtin-sites/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-key': KEY },
    body: JSON.stringify({ sites: S(100) }),
  })
  const d = await r.json().catch(() => ({}))
  ok(r.status === 200 && d.ok && d.accepted === 100 && d.total === 100, `导入 100 条 (got ${r.status} ${JSON.stringify(d).slice(0, 120)})`)
}

// 4. 幂等 upsert：同 url 重导 → total 不变，字段被更新
{
  const mod = S(3).map(s => ({ ...s, name: s.name + '改', rate: 42 }))
  const r = await fetch(BASE + '/api/builtin-sites/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-key': KEY },
    body: JSON.stringify({ sites: mod }),
  })
  const d = await r.json().catch(() => ({}))
  ok(r.status === 200 && d.total === 100, `重导 3 条 total 仍 100 (got ${r.status} total=${d.total})`)
  const q = await jf(BASE + '/api/builtin-sites?q=' + encodeURIComponent('站点0改'))
  ok(q.items.length === 1 && q.items[0].rate === 42, '重导后名称/热度已更新')
}

// 5. 分类过滤 + 未知分类被丢弃
{
  const d = await jf(BASE + '/api/builtin-sites?cat=app&pageSize=200')
  ok(d.total === 50, `cat=app 共 50 (got ${d.total})`)
  ok(d.items.every(i => i.cats.includes('app') && i.cats.every(c => c !== '未知分类')), 'items 分类正确且未知分类被过滤')
  const g = await jf(BASE + '/api/builtin-sites?cat=games')
  ok(g.total === 50, `cat=games 共 50 (got ${g.total})`)
  const bad = await fetch(BASE + '/api/builtin-sites?cat=nope')
  ok(bad.status === 400, `未知分类查询 → 400 (got ${bad.status})`)
}

// 6. 搜索（name/url）+ 分页 + 排序
{
  const d = await jf(BASE + '/api/builtin-sites?q=example9.com')
  ok(d.items.length >= 3 && d.items.every(i => i.url.includes('example9.com')), 'url 搜索命中')
  const p1 = await jf(BASE + '/api/builtin-sites?page=1&pageSize=30')
  const p2 = await jf(BASE + '/api/builtin-sites?page=2&pageSize=30')
  ok(p1.items.length === 30 && p2.items.length === 30, `分页各 30 条 (got ${p1.items.length}/${p2.items.length})`)
  ok(p1.items.length && p2.items.length && p1.items[0].url !== p2.items[0].url, '两页不重叠')
  ok(p1.items.length && p1.items[0].rate >= p1.items[p1.items.length - 1].rate, '按热度降序')
}

// 7. 字段校验：非法 url / 缺 name → 422；单请求超 150 → 413
{
  const r = await fetch(BASE + '/api/builtin-sites/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-key': KEY },
    body: JSON.stringify({ sites: [{ url: 'notaurl', name: 'x' }, { url: 'https://ok.com', name: '' }] }),
  })
  ok(r.status === 422, `全部非法 → 422 (got ${r.status})`)
  const r2 = await fetch(BASE + '/api/builtin-sites/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-key': KEY },
    body: JSON.stringify({ sites: S(151) }),
  })
  ok(r2.status === 413, `151 条 → 413 (got ${r2.status})`)
}

// 8. 清库（测试库无妨）：重复 upsert 不产生重复 url
{
  const r = await fetch(BASE + '/api/builtin-sites/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-import-key': KEY },
    body: JSON.stringify({ sites: S(100) }),
  })
  const d = await r.json().catch(() => ({}))
  ok(d.total === 100, `全量重导后 total 仍 100 (got ${d.total})`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
