// 内置导航目录数据完整性测试（Node 直跑）
import assert from 'node:assert/strict'
import { BUILTIN_CATEGORIES, BUILTIN_SITES } from '../src/data/builtinSites.js'

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ✗ ${name}\n    ${e.message}`)
  }
}

console.log('== 内置导航数据 ==')
test('分类数量 ≥ 12 且 key 唯一', () => {
  assert.ok(BUILTIN_CATEGORIES.length >= 12, `实际 ${BUILTIN_CATEGORIES.length} 个分类`)
  const keys = BUILTIN_CATEGORIES.map((c) => c.key)
  assert.equal(new Set(keys).size, keys.length, '分类 key 有重复')
})
test('每个分类都有 name 和 group', () => {
  for (const c of BUILTIN_CATEGORIES) {
    assert.ok(c.name && c.group, `分类 ${c.key} 缺 name/group`)
  }
})
test('站点数量 ≥ 100', () => {
  assert.ok(BUILTIN_SITES.length >= 100, `实际 ${BUILTIN_SITES.length} 个站点`)
})
test('每个站点字段齐全（name/url/desc/cat/icon）', () => {
  for (const s of BUILTIN_SITES) {
    assert.ok(s.name && s.url && s.cat && s.icon, `站点字段缺失: ${JSON.stringify(s).slice(0, 80)}`)
    assert.ok(typeof s.desc === 'string' && s.desc.length > 0, `${s.name} 缺描述`)
  }
})
test('站点 cat 必须存在于分类表', () => {
  const keys = new Set(BUILTIN_CATEGORIES.map((c) => c.key))
  for (const s of BUILTIN_SITES) {
    assert.ok(keys.has(s.cat), `${s.name} 的分类 ${s.cat} 未定义`)
  }
})
test('URL 全部为合法 http(s) 链接', () => {
  for (const s of BUILTIN_SITES) {
    assert.match(s.url, /^https?:\/\/[^\s]+\.[^\s]+$/, `${s.name} URL 非法: ${s.url}`)
    assert.doesNotMatch(s.url, /\s/, `${s.name} URL 含空白`)
  }
})
test('每个分类至少 5 个站点', () => {
  const m = {}
  for (const s of BUILTIN_SITES) m[s.cat] = (m[s.cat] || 0) + 1
  for (const c of BUILTIN_CATEGORIES) {
    assert.ok((m[c.key] || 0) >= 5, `分类 ${c.name} 仅 ${m[c.key] || 0} 个站点`)
  }
})
test('同一分类内 URL 唯一（跨分类允许重复精选）', () => {
  const seen = new Set()
  for (const s of BUILTIN_SITES) {
    const k = s.cat + ' ' + s.url
    assert.ok(!seen.has(k), `分类内 URL 重复: ${k}`)
    seen.add(k)
  }
})
test('描述长度 ≤ 30 字且无换行', () => {
  for (const s of BUILTIN_SITES) {
    assert.ok(s.desc.length <= 30, `${s.name} 描述过长（${s.desc.length} 字）`)
    assert.ok(!/[\n\r]/.test(s.desc), `${s.name} 描述含换行`)
  }
})
test('icon 均为 https 链接', () => {
  for (const s of BUILTIN_SITES) {
    assert.match(s.icon, /^https:\/\/.+$/, `${s.name} icon 非法: ${s.icon}`)
  }
})
test('同一 URL 至多出现在一个细分分类（可额外镜像进「受欢迎的」）', () => {
  const byUrl = new Map()
  for (const s of BUILTIN_SITES) {
    if (!byUrl.has(s.url)) byUrl.set(s.url, new Set())
    byUrl.get(s.url).add(s.cat)
  }
  for (const [url, cats] of byUrl) {
    const nonPopular = [...cats].filter((c) => c !== 'popular')
    assert.ok(nonPopular.length <= 1, `${url} 在多个细分分类重复: ${nonPopular.join(', ')}`)
  }
})
test('「受欢迎的」分类与其他分类有交集（精选镜像设计）', () => {
  const popularUrls = new Set(BUILTIN_SITES.filter((s) => s.cat === 'popular').map((s) => s.url))
  const otherUrls = BUILTIN_SITES.filter((s) => s.cat !== 'popular').map((s) => s.url)
  assert.ok(otherUrls.some((u) => popularUrls.has(u)), '精选分类未镜像任何站点')
})

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
