// API 级端到端测试：管理员用户管理 + 邮箱找回密码
// 前置（三个终端或后台进程）：
//   1. node scripts/mock-resend.mjs 9999
//   2. npx wrangler pages dev dist --port 8788 \
//        --var RESEND_API_KEY:test-key \
//        --var RESEND_API_BASE:http://127.0.0.1:9999 \
//        --var "ADMIN_EMAILS:594328762@qq.com,admin-e2e@test.dev"
// 用法：BASE=http://127.0.0.1:8788 node scripts/test-admin-reset.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8788'
const MOCK = process.env.MOCK || 'http://127.0.0.1:9999'
const ADMIN_EMAIL = 'admin-e2e@test.dev' // 必须与 wrangler --var ADMIN_EMAILS 一致

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
const register = async (email, password) => {
  const j = jar()
  const res = await call('POST', '/api/auth/register', { email, password }, j)
  return { j, res, data: await res.json().catch(() => ({})) }
}

const ts = Date.now()
const USER = `u-${ts}@test.dev`
const ADMIN2 = `594328762@qq.com` // 默认管理员，用于验证 wrangler.toml/默认值双管理员

// 重复运行时账号可能已存在：register → 409 则改用登录
const ensureUser = async (email, password) => {
  const j = jar()
  let res = await call('POST', '/api/auth/register', { email, password }, j)
  let data = await res.json().catch(() => ({}))
  if (res.status === 409) {
    j.clear()
    res = await call('POST', '/api/auth/login', { email, password }, j)
    data = await res.json().catch(() => ({}))
  }
  return { j, res, data }
}

// 0. 纯函数抽查：admin 判定与验证码
{
  const { adminEmails, isAdminEmail, randomCode } = await import('../functions/lib/auth.js')
  ok(adminEmails({}).has('594328762@qq.com'), 'default admin fallback')
  ok(adminEmails({ ADMIN_EMAILS: 'a@x.com, b@y.com' }).has('b@y.com'), 'env list parsing')
  ok(!isAdminEmail({}, 'someone@else.com'), 'non-admin rejected')
  ok(/^[0-9]{6}$/.test(randomCode()), 'random code 6 digits')
}

// 1. 注册：普通用户、两个管理员
const U = await ensureUser(USER, 'userPass123')
ok(U.res.status === 200 && U.data.isAdmin === false, 'normal user registers, isAdmin=false')
const A = await ensureUser(ADMIN_EMAIL, 'adminPass123')
ok(A.res.status === 200 && A.data.isAdmin === true, 'admin email login-flagged at register')
const A2 = await ensureUser(ADMIN2, 'adminPass123')
ok(A2.res.status === 200 && A2.data.isAdmin === true, 'default admin (qq) also flagged')

// 2. 普通用户访问管理 API → 403
const no = await call('GET', '/api/admin/users', null, U.j)
ok(no.status === 403, `non-admin list users → 403 (got ${no.status})`)
const no2 = await call('POST', '/api/admin/delete-user', { userId: 1 }, U.j)
ok(no2.status === 403, `non-admin delete → 403 (got ${no2.status})`)

// 3. 管理员列表 → 包含普通用户且计数正确
const list = await call('GET', '/api/admin/users', null, A.j)
const ld = await list.json().catch(() => ({}))
ok(list.status === 200 && Array.isArray(ld.users), 'admin list users ok')
const row = (ld.users || []).find(u => u.email === USER)
ok(row && row.isAdmin === false && row.prefs === 0 && row.sessions >= 1, 'user row with correct stats')
ok((ld.users || []).find(u => u.email === ADMIN2)?.isAdmin === true, 'qq admin flagged in list')
ok(!('pwd_hash' in (row || {})), 'no pwd_hash leak')

// 4. 管理员重置普通用户密码 → 该用户被踢下线，新密码可登录
const victimLogin = jar()
await call('POST', '/api/auth/login', { email: USER, password: 'userPass123' }, victimLogin)
ok((await call('GET', '/api/auth/me', null, victimLogin)).status === 200, 'victim logged in before reset')

const rp = await call('POST', '/api/admin/reset-password', { userId: row.id, newPassword: 'newPass999' }, A.j)
ok(rp.status === 200, `admin reset password ok (got ${rp.status})`)
ok((await call('GET', '/api/auth/me', null, victimLogin)).status === 401, 'victim sessions revoked after admin reset')
const relog = await call('POST', '/api/auth/login', { email: USER, password: 'newPass999' }, jar())
ok(relog.status === 200, 'victim logs in with admin-set password')

// 5. 管理员删除保护 + 删除用户
const delSelf = await call('POST', '/api/admin/delete-user', { userId: (ld.users.find(u => u.email === ADMIN_EMAIL)).id }, A.j)
ok(delSelf.status === 403, 'admin cannot delete admin account')
const del = await call('POST', '/api/admin/delete-user', { userId: row.id }, A.j)
ok(del.status === 200, 'admin deletes user')
const goneLogin = await call('POST', '/api/auth/login', { email: USER, password: 'newPass999' }, jar())
ok(goneLogin.status === 403, 'deleted user cannot login')

// 6. 未注册邮箱走找回 → 通用成功响应（防枚举，不发信）
const ghost = await call('POST', '/api/auth/forgot', { email: `ghost-${ts}@test.dev` }, jar())
ok(ghost.status === 200 && (await ghost.json()).ok === true, 'forgot for unknown email → generic ok')

// 7. 找回密码全流程（mock 邮件）
const V = `v-${ts}@test.dev`
const vReg = await register(V, 'oldPass111')
ok(vReg.res.status === 200, 'victim2 registered')
const f1 = await call('POST', '/api/auth/forgot', { email: V }, jar())
ok(f1.status === 200, 'forgot sends mail')
const codeRes = await fetch(`${MOCK}/last-code`)
const { code } = await codeRes.json()
ok(/^[0-9]{6}$/.test(code || ''), `mock mail captured code (${code})`)

// 先登录保留一个会话，验证重置后会被吊销
const vJar = jar()
await call('POST', '/api/auth/login', { email: V, password: 'oldPass111' }, vJar)

// 错误验证码 → 400；连续错 5 次后作废
let lastErr = null
for (let i = 0; i < 5; i++) {
  lastErr = await call('POST', '/api/auth/reset', { email: V, code: '000000', newPassword: 'whatever123' }, jar())
  if (lastErr.status !== 400) break
}
ok(lastErr.status === 429 || lastErr.status === 400, 'wrong codes punished (lockout)')

// 重新获取验证码再正确重置
await call('POST', '/api/auth/forgot', { email: V }, jar())
const code2 = (await (await fetch(`${MOCK}/last-code`)).json()).code
const rs = await call('POST', '/api/auth/reset', { email: V, code: code2, newPassword: 'resetPass888' }, jar())
ok(rs.status === 200, `reset with correct code ok (got ${rs.status})`)
ok((await call('GET', '/api/auth/me', null, vJar)).status === 401, 'old sessions revoked after reset')
ok((await call('POST', '/api/auth/login', { email: V, password: 'oldPass111' }, jar())).status === 403, 'old password dead')
ok((await call('POST', '/api/auth/login', { email: V, password: 'resetPass888' }, jar())).status === 200, 'new password works')

// 8. 清理（登录后注销，避免残留账号）
const cJ = jar()
await call('POST', '/api/auth/login', { email: V, password: 'resetPass888' }, cJ)
const cleanup = await call('DELETE', '/api/user/account', { currentPassword: 'resetPass888' }, cJ)
ok(cleanup.status === 200, 'cleanup delete ok')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
