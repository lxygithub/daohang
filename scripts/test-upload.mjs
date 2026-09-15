// API 级端到端测试：自建图床上传代理 /api/upload
// 前置：
//   1. node scripts/mock-imgbed.mjs            （图床 mock，端口 9001）
//   2. wrangler pages dev（.dev.vars 含 IMG_UPLOAD_API=http://127.0.0.1:9001/upload）
// 用法：node scripts/test-upload.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8788'
const IMGBED = 'http://127.0.0.1:9001'

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)) }
const jar = () => {
  let cookie = ''
  return {
    header: () => cookie,
    absorb(res) {
      const list = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean)
      for (const c of list) {
        const [pair] = c.split(';')
        if (pair === 'nav_session=') cookie = ''
        else if (pair.startsWith('nav_session=')) cookie = pair
      }
    },
  }
}

const email = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`
const P = 'uploadPass123'

// 1. 注册拿会话
const A = jar()
{
  const res = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: P }),
  })
  A.absorb(res)
  ok(res.status === 200, `register → 200 (got ${res.status})`)
}

// 2. 探测：图床已配置
{
  const d = await (await fetch(BASE + '/api/upload')).json()
  ok(d.enabled === true, 'GET /api/upload → {enabled:true}')
}

// 3. 未登录上传 → 401
{
  const fd = new FormData()
  fd.append('file', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }), 'x.png')
  const res = await fetch(BASE + '/api/upload', { method: 'POST', body: fd })
  ok(res.status === 401, `upload without session → 401 (got ${res.status})`)
}

// 4. 正常上传 PNG → 200 + 外链 URL（与 mock 返回一致）
let gotUrl = ''
{
  // 最小合法 PNG（1x1）
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  const fd = new FormData()
  fd.append('file', new Blob([Uint8Array.from(atob(pngB64), c => c.charCodeAt(0))], { type: 'image/png' }), 'icon.png')
  const res = await fetch(BASE + '/api/upload', { method: 'POST', body: fd, headers: { Cookie: A.header() } })
  const d = await res.json().catch(() => ({}))
  ok(res.status === 200 && d.ok === true, `upload png → 200 ok (got ${res.status})`)
  ok(/^http:\/\/127\.0\.0\.1:9001\/file\/\d+_[a-z0-9]+\.png$/.test(d.url || ''), `relative src resolved against bed origin (got ${d.url})`)
  gotUrl = d.url || ''
}

// 5. mock 图床确实收到了multipart（字段消费、体积>0）
{
  const last = await (await fetch(IMGBED + '/last')).json()
  ok((last.size || 0) > 0, 'mock bed received multipart body')
}

// 6. 非图片文件 → 415
{
  const fd = new FormData()
  fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt')
  const res = await fetch(BASE + '/api/upload', { method: 'POST', body: fd, headers: { Cookie: A.header() } })
  ok(res.status === 415, `text file → 415 (got ${res.status})`)
}

// 7. 超过 8MB → 413
{
  const big = new Blob([new Uint8Array(8 * 1024 * 1024 + 100)], { type: 'image/png' })
  const fd = new FormData()
  fd.append('file', big, 'big.png')
  const res = await fetch(BASE + '/api/upload', { method: 'POST', body: fd, headers: { Cookie: A.header() } })
  ok(res.status === 413, `>8MB → 413 (got ${res.status})`)
}

// 8. 缺少 file 字段 → 400
{
  const fd = new FormData()
  fd.append('other', 'x')
  const res = await fetch(BASE + '/api/upload', { method: 'POST', body: fd, headers: { Cookie: A.header() } })
  ok(res.status === 400, `missing file field → 400 (got ${res.status})`)
}

// 9. 返回的外链可被 GET（mock 提供占位）——保证 URL 格式真实可拼
ok(gotUrl.startsWith(IMGBED + '/file/'), 'returned url points at bed origin')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
