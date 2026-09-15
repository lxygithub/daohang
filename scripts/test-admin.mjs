// API 级端到端测试：管理员用户搜索 + 禁用/启用
// 前置（两个后台进程）：
//   1. node scripts/mock-resend.mjs 9999
//   2. npx wrangler pages dev dist --port 8788   （.dev.vars 已注入 RESEND_API_KEY / RESEND_API_BASE / ADMIN_EMAILS）
// 用法：BASE=http://127.0.0.1:8788 node scripts/test-admin.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8788'
const MOCK = process.env.MOCK || 'http://127.0.0.1:9999'
const ADMIN_EMAIL = 'admin-e2e@test.dev' // 必须与 .dev.vars ADMIN_EMAILS 一致

let pass = 0, fail = 0
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('FAIL:', name)) }
const jar = () => {
  let cookie = ''
  return {
    header: () => cookie,
    clear() { cookie = '' },
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
const call = async (method, path, body, j) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(j?.header() ? { Cookie: j.header() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  j?.absorb(res)
  return res
}
const ensureUser = async (email, password) => {
  const j = jar()
  let res = await call('POST', '/api/auth/register', { email, password }, j)
  if (res.status === 409) {
    j.clear()
    res = await call('POST', '/api/auth/login', { email, password }, j)
  }
  return { j, res }
}

const ts = Date.now()
const SD = `sd-${ts}@test.dev`

// 0. 管理员与普通用户就位
const A = await ensureUser(ADMIN_EMAIL, 'adminPass123')
ok(A.res.status === 200, 'admin ready')
const U = await ensureUser(SD, 'userPass123')
ok(U.res.status === 200, 'target user ready')

// 1. 非管理员调用禁用 API → 403
const no = await call('POST', '/api/admin/set-disabled', { userId: 1, disabled: 1 }, U.j)
ok(no.status === 403, `non-admin set-disabled → 403 (got ${no.status})`)

// 2. 搜索：精确子串命中自身
const hit = await call('GET', `/api/admin/users?q=${encodeURIComponent(SD)}`, null, A.j)
const hd = await hit.json().catch(() => ({}))
ok(hit.status === 200 && (hd.users || []).length === 1 && hd.users[0].email === SD, 'search by exact email → 1 hit')
ok(hd.users?.[0]?.disabled === 0, 'list exposes disabled=0')

// 3. 搜索：无匹配 → 空数组
const miss = await call('GET', `/api/admin/users?q=${encodeURIComponent(`nohit-${ts}@x.dev`)}`, null, A.j)
const md = await miss.json().catch(() => ({}))
ok(miss.status === 200 && (md.users || []).length === 0, 'search no match → empty')

// 4. 搜索：LIKE 通配符被转义，不报错不放大匹配
const wild = await call('GET', `/api/admin/users?q=${encodeURIComponent('%')}`, null, A.j)
ok(wild.status === 200, `search with % literal → 200 (got ${wild.status})`)
const under = await call('GET', `/api/admin/users?q=${encodeURIComponent('_')}`, null, A.j)
const ud = await under.json().catch(() => ({}))
const all = await call('GET', '/api/admin/users', null, A.j)
const ad = await all.json().catch(() => ({}))
ok(under.status === 200 && (ud.users || []).length === 0 && (ad.users || []).length >= 1,
  "search with _ literal matches nothing (escaped), full list non-empty")

// 5. 目标用户登录保会话 + 启用状态下忘记密码拿到验证码
const vJar = jar()
await call('POST', '/api/auth/login', { email: SD, password: 'userPass123' }, vJar)
ok((await call('GET', '/api/auth/me', null, vJar)).status === 200, 'target logged in before disable')
await call('POST', '/api/auth/forgot', { email: SD }, jar())
const code = (await (await fetch(`${MOCK}/last-code`)).json()).code
ok(/^[0-9]{6}$/.test(code || ''), `forgot mail captured code (${code})`)

// 6. 管理员禁用目标用户
const row = hd.users[0]
const dis = await call('POST', '/api/admin/set-disabled', { userId: row.id, disabled: 1 }, A.j)
const dd = await dis.json().catch(() => ({}))
ok(dis.status === 200 && dd.ok === true, `admin disables user (got ${dis.status})`)

// 7. 禁用即刻生效：旧会话下线、登录被拒、验证码重置被拒
ok((await call('GET', '/api/auth/me', null, vJar)).status === 401, 'disabled user session revoked immediately')
const relog = await call('POST', '/api/auth/login', { email: SD, password: 'userPass123' }, jar())
const rd = await relog.json().catch(() => ({}))
ok(relog.status === 403 && /禁用/.test(rd.error || ''), `disabled login rejected with reason (got ${relog.status})`)
const rst = await call('POST', '/api/auth/reset', { email: SD, code, newPassword: 'hacked999' }, jar())
ok(rst.status === 403, `reset with pre-disable code rejected (got ${rst.status})`)

// 8. 防护：管理员不可被禁用；不存在的用户 → 404
const adminRow = ad.users.find(u => u.email === ADMIN_EMAIL)
const disAdmin = await call('POST', '/api/admin/set-disabled', { userId: adminRow.id, disabled: 1 }, A.j)
ok(disAdmin.status === 403, `admin account cannot be disabled (got ${disAdmin.status})`)
const dis404 = await call('POST', '/api/admin/set-disabled', { userId: 99999999, disabled: 1 }, A.j)
ok(dis404.status === 404, `set-disabled unknown user → 404 (got ${dis404.status})`)

// 9. 启用恢复：登录恢复、列表 disabled=0
const en = await call('POST', '/api/admin/set-disabled', { userId: row.id, disabled: 0 }, A.j)
ok(en.status === 200, `admin enables user (got ${en.status})`)
ok((await call('POST', '/api/auth/login', { email: SD, password: 'userPass123' }, jar())).status === 200,
  're-enabled user can login again')
const after = await call('GET', `/api/admin/users?q=${encodeURIComponent(SD)}`, null, A.j)
const ad2 = await after.json().catch(() => ({}))
ok(ad2.users?.[0]?.disabled === 0, 'list shows disabled=0 after enable')

// 10. 清理：管理员删除测试用户
const del = await call('POST', '/api/admin/delete-user', { userId: row.id }, A.j)
ok(del.status === 200, 'cleanup: admin deletes test user')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
