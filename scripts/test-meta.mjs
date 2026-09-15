// 站点标题/图标获取服务测试（Node 直跑，无需 wrangler）
// 覆盖：GBK 编码解码、无引号属性解析、data: URI、fallback 路径探测、
//       候选图标验证、403 原因透传、内网 fail-fast、ALLOW_PRIVATE_FETCH 逃生门、
//       前端工具函数（isPrivateHost / normalizeSiteUrl / extractTitle）
import http from 'node:http'
import assert from 'node:assert/strict'
import {
  fetchHtml,
  findIcon,
  isPrivateHost,
  extractIconCandidates,
  onRequest as faviconOnRequest,
} from '../functions/api/favicon.js'
import { onRequest as metaOnRequest } from '../functions/api/meta.js'
import {
  normalizeSiteUrl,
  isPrivateHost as feIsPrivateHost,
  extractTitle as feExtractTitle,
  mixedContentBlocked,
} from '../src/utils/siteMeta.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
const GBK_BAIDU = Buffer.from([0xb0, 0xd9, 0xb6, 0xc8]) // 「百度」的 GBK 编码

let server
let port
let forbiddenHits = 0

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x')
      const p = u.pathname
      const png = (extra = {}) => {
        res.writeHead(200, { 'Content-Type': 'image/png', ...extra })
        res.end(PNG)
      }
      if (p === '/favicon.ico') return png({ 'Content-Type': 'application/octet-stream' })
      if (p === '/favicon-x.png' || p === '/apple-touch.png' || p === '/tile.png' || p === '/ico') return png()
      if (p === '/gbk') {
        // 仅在 body 里声明 charset（不靠响应头），考验嗅探逻辑
        const body = Buffer.concat([
          Buffer.from('<html><head><meta charset="gb2312"></head><title>'),
          GBK_BAIDU,
          Buffer.from('</title></html>'),
        ])
        res.writeHead(200, { 'Content-Type': 'text/html' })
        return res.end(body)
      }
      if (p === '/unquoted') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end('<html><head><link rel=icon href=/favicon-x.png></head><title>Unquoted Site</title></html>')
      }
      if (p === '/datauri') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end('<html><head><link rel="icon" href="data:image/png;base64,iVBORw0KGgo="></head><title>Data URI Site</title></html>')
      }
      if (p === '/apple') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end('<html><head><link rel="apple-touch-icon" href="/apple-touch.png"></head><title>Apple Site</title></html>')
      }
      if (p === '/tile') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end('<html><head><meta name="msapplication-TileImage" content="/tile.png"></head><title>Tile Site</title></html>')
      }
      if (p === '/ent') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end('<html><head><link rel="icon" href="/ico?a=1&amp;b=2"></head><title>Entity Site</title></html>')
      }
      if (p === '/noicon') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        return res.end('<html><head></head><title>No Icon Site</title><body>hello</body></html>')
      }
      if (p === '/forbidden') {
        forbiddenHits++
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        return res.end('blocked')
      }
      res.writeHead(404)
      res.end('not found')
    })
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      resolve()
    })
  })
}

const base = () => `http://127.0.0.1:${port}`
// mock 服务器在 127.0.0.1 上，属内网地址：流量测试默认走 ALLOW_PRIVATE_FETCH 逃生门，
// 内网闸行为由专门的 fail-fast 用例覆盖（env 传 {}）
const metaCall = (target, env) =>
  metaOnRequest({
    request: new Request('http://localhost:8787/api/meta?url=' + encodeURIComponent(target)),
    env: env ?? { ALLOW_PRIVATE_FETCH: '1' },
  }).then((r) => r.json())

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failed++
    console.error(`  ✗ ${name}\n    ${e.message}`)
  }
}

await startServer()

console.log('== 服务端：fetchHtml / 编码 ==')
await test('GBK 页面按声明编码解码，标题不乱码', async () => {
  const r = await fetchHtml(base() + '/gbk')
  const m = r.html.match(/<title>([\s\S]*?)<\/title>/)
  assert.equal(m[1], '百度')
})

console.log('== 服务端：meta onRequest ==')
await test('GBK 站点标题正确返回', async () => {
  const d = await metaCall(base() + '/gbk')
  assert.equal(d.title, '百度')
})
await test('无引号属性 <link rel=icon href=...> 可解析', async () => {
  const d = await metaCall(base() + '/unquoted')
  assert.equal(d.title, 'Unquoted Site')
  assert.equal(d.icon, base() + '/favicon-x.png')
})
await test('data:image URI 图标直接采用', async () => {
  const d = await metaCall(base() + '/datauri')
  assert.equal(d.icon, 'data:image/png;base64,iVBORw0KGgo=')
})
await test('apple-touch-icon 作为次级候选', async () => {
  const d = await metaCall(base() + '/apple')
  assert.equal(d.icon, base() + '/apple-touch.png')
})
await test('msapplication-TileImage 作为末级候选', async () => {
  const d = await metaCall(base() + '/tile')
  assert.equal(d.icon, base() + '/tile.png')
})
await test('href 实体（&amp;）解码后拼接', async () => {
  const d = await metaCall(base() + '/ent')
  assert.equal(d.icon, base() + '/ico?a=1&b=2')
})
await test('无声明图标 → fallback /favicon.ico（octet-stream 按扩展名放行）', async () => {
  const d = await metaCall(base() + '/noicon')
  assert.equal(d.title, 'No Icon Site')
  assert.equal(d.icon, base() + '/favicon.ico')
})
await test('403 站点：错误原因透传 + 图标仍走 fallback 成功', async () => {
  forbiddenHits = 0
  const d = await metaCall(base() + '/forbidden')
  assert.equal(d.error, 'HTTP 403')
  assert.equal(d.title, '')
  assert.equal(d.icon, base() + '/favicon.ico')
  assert.equal(forbiddenHits, 1, '页面只应抓取一次（避免二次抓取拖慢总耗时）')
})
await test('内网地址 fail-fast：lan:true 秒回', async () => {
  const t0 = Date.now()
  const d = await metaCall(base() + '/noicon', {})
  assert.equal(d.lan, true)
  assert.equal(d.icon, null)
  assert.ok(Date.now() - t0 < 1000, `应在 1s 内返回，实际 ${Date.now() - t0}ms`)
})
await test('ALLOW_PRIVATE_FETCH=1 逃生门：内网可正常抓取（自托管场景）', async () => {
  const d = await metaCall(base() + '/noicon', { ALLOW_PRIVATE_FETCH: '1' })
  assert.equal(d.title, 'No Icon Site')
  assert.equal(d.icon, base() + '/favicon.ico')
})
await test('无效链接返回链接无效', async () => {
  const d = await metaCall('http://')
  assert.equal(d.error, '链接无效')
})

console.log('== 服务端：favicon onRequest ==')
await test('内网地址 fail-fast', async () => {
  const res = await faviconOnRequest({
    request: new Request('http://localhost:8787/api/favicon?url=' + encodeURIComponent(base() + '/noicon')),
    env: {},
  })
  const d = await res.json()
  assert.equal(d.found, false)
  assert.equal(d.lan, true)
})

console.log('== 服务端：extractIconCandidates / findIcon ==')
await test('候选按 icon > apple-touch > tile 排序', () => {
  const c = extractIconCandidates(
    '<link rel="apple-touch-icon" href="/a.png"><link rel="icon" href="/b.png"><meta name="msapplication-tileimage" content="/c.png">'
  )
  assert.deepEqual(c.icons, ['/b.png'])
  assert.deepEqual(c.apple, ['/a.png'])
  assert.deepEqual(c.tiles, ['/c.png'])
})
await test('findIcon：声明了 favicon 但已 404 → 回退到可用路径', async () => {
  // /dead 站点声明了不存在的 /dead-icon.png，mock 对其 404
  const icon = await findIcon(base() + '/dead')
  // /dead 路由 404 → fetchHtml 抛错 → 无候选 → fallback /favicon.ico
  assert.equal(icon, base() + '/favicon.ico')
})

console.log('== 服务端：isPrivateHost ==')
const privates = ['192.168.1.10', '10.0.0.1', '172.16.0.1', '172.31.255.255', '127.0.0.1', '100.100.1.1', 'nas.local', 'my.lan', 'localhost', 'box.internal', '169.254.1.1']
const publics = ['172.32.0.1', '100.50.1.1', 'example.com', '8.8.8.8', 'foo.local.example.com']
for (const h of privates) {
  await test(`isPrivateHost(${h}) === true`, () => assert.equal(isPrivateHost(h), true))
}
for (const h of publics) {
  await test(`isPrivateHost(${h}) === false`, () => assert.equal(isPrivateHost(h), false))
}

console.log('== 前端：siteMeta.js 纯函数 ==')
await test('normalizeSiteUrl：内网裸地址补 http://', () => {
  assert.equal(normalizeSiteUrl('192.168.1.10:5000'), 'http://192.168.1.10:5000/')
  assert.equal(normalizeSiteUrl('nas.local:5000/web'), 'http://nas.local:5000/web')
})
await test('normalizeSiteUrl：公网裸地址补 https://', () => {
  assert.equal(normalizeSiteUrl('example.com'), 'https://example.com/')
  assert.equal(normalizeSiteUrl('example.com/path?q=1'), 'https://example.com/path?q=1')
})
await test('normalizeSiteUrl：已带协议原样保留', () => {
  assert.equal(normalizeSiteUrl('http://a.b/c'), 'http://a.b/c')
  assert.equal(normalizeSiteUrl('https://example.com'), 'https://example.com/')
})
await test('normalizeSiteUrl：非法输入返回空', () => {
  assert.equal(normalizeSiteUrl(''), '')
  assert.equal(normalizeSiteUrl('   '), '')
})
await test('前端 isPrivateHost 与服务端行为一致', () => {
  assert.equal(feIsPrivateHost('192.168.1.1'), true)
  assert.equal(feIsPrivateHost('example.com'), false)
})
await test('前端 extractTitle：og:title 优先 + 实体解码', () => {
  assert.equal(feExtractTitle('<meta property="og:title" content="A &amp; B"><title>T</title>'), 'A & B')
  assert.equal(feExtractTitle('<title>T2</title>'), 'T2')
  assert.equal(feExtractTitle(''), '')
})
await test('mixedContentBlocked：Node 环境（无 location）返回 false', () => {
  assert.equal(mixedContentBlocked('http://192.168.1.1'), false)
})

server.close()
console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed ? 1 : 0)
