// API 级端到端测试：账号管理（修改密码 / 注销账号）
// 前置：wrangler pages dev 已在 BASE（默认 http://127.0.0.1:8788）运行
//   npx wrangler pages dev dist --d1 DB=xxx --port 8788
// 用法：node scripts/test-account.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:8788'

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
        if (pair === 'nav_session=') cookie = ''                       // Max-Age=0 清除
        else if (pair.startsWith('nav_session=')) cookie = pair        // 正常会话
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

const email = `acct-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.dev`
const P1 = 'firstPass123', P2 = 'secondPass456', P3 = 'thirdPass789'

// 1. 注册
const A = jar()
const reg = await call('POST', '/api/auth/register', { email, password: P1 }, A)
ok(reg.status === 200, `register → 200 (got ${reg.status})`)

// 2. 会话有效
const me1 = await call('GET', '/api/auth/me', null, A)
ok(me1.status === 200 && (await me1.json()).email === email, 'me after register')

// 3. 写一条偏好，供注销后验证数据被清
const put = await call('PUT', '/api/user/prefs', { entries: [{ key: 'view', value: '"alpha"', t: Date.now() }] }, A)
ok(put.status === 200, 'put pref')

// 4. 修改密码 — 当前密码错误 → 403
const bad1 = await call('POST', '/api/user/password', { currentPassword: 'wrong!', newPassword: P2 }, A)
ok(bad1.status === 403, `change pwd wrong current → 403 (got ${bad1.status})`)

// 5. 新密码过短 → 400
const bad2 = await call('POST', '/api/user/password', { currentPassword: P1, newPassword: '123' }, A)
ok(bad2.status === 400, `change pwd short new → 400 (got ${bad2.status})`)

// 6. 正常修改 → ok，当前设备不掉线
const chg = await call('POST', '/api/user/password', { currentPassword: P1, newPassword: P2 }, A)
ok(chg.status === 200 && (await chg.json()).ok === true, 'change pwd ok')
const me2 = await call('GET', '/api/auth/me', null, A)
ok(me2.status === 200, 'current device session kept after change')

// 7. 设备 B 用新密码登录成功
const B = jar()
const loginB = await call('POST', '/api/auth/login', { email, password: P2 }, B)
ok(loginB.status === 200, 'device B login with new pwd')

// 8. 设备 A 再改一次密码 → 设备 B 会话被吊销
await call('POST', '/api/user/password', { currentPassword: P2, newPassword: P3 }, A)
const meB = await call('GET', '/api/auth/me', null, B)
ok(meB.status === 401, `other device revoked after pwd change (got ${meB.status})`)
const meA = await call('GET', '/api/auth/me', null, A)
ok(meA.status === 200, 'device A still valid')

// 9. 旧密码登录失败、新密码成功
const oldIn = await call('POST', '/api/auth/login', { email, password: P1 }, jar())
ok(oldIn.status === 403, 'old pwd rejected')
const newIn = await call('POST', '/api/auth/login', { email, password: P3 }, jar())
ok(newIn.status === 200, 'latest pwd accepted')

// 10. 注销账号 — 密码错误 → 403
const delBad = await call('DELETE', '/api/user/account', { currentPassword: 'nope!' }, A)
ok(delBad.status === 403, `delete wrong pwd → 403 (got ${delBad.status})`)

// 11. 注销账号 — 正确 → ok，会话清除
const del = await call('DELETE', '/api/user/account', { currentPassword: P3 }, A)
ok(del.status === 200 && (await del.json()).ok === true, 'delete account ok')
ok(!A.header(), 'cookie cleared client-side')
const me3 = await call('GET', '/api/auth/me', null, A)
ok(me3.status === 401, 'session invalid after delete')

// 12. 已删用户登录失败
const gone = await call('POST', '/api/auth/login', { email, password: P3 }, jar())
ok(gone.status === 403, 'deleted user cannot login')

// 13. 未登录调用 → 401
const anon1 = await call('POST', '/api/user/password', { currentPassword: 'x', newPassword: 'yyyyyy' }, jar())
const anon2 = await call('DELETE', '/api/user/account', { currentPassword: 'x' }, jar())
ok(anon1.status === 401 && anon2.status === 401, 'anonymous requests → 401')

// 14. 邮箱已释放，可重新注册；云端偏好为空（数据确实被删）
const re = await call('POST', '/api/auth/register', { email, password: P1 }, jar())
ok(re.status === 200, `email freed for re-register (got ${re.status})`)
const C = jar()
await call('POST', '/api/auth/login', { email, password: P1 }, C)
const prefs = await call('GET', '/api/user/prefs', null, C)
const pd = await prefs.json()
ok(prefs.status === 200 && Object.keys(pd.data || {}).length === 0, 'cloud prefs wiped with account')

// 15. 清理：删掉测试重建的账号
const cleanup = await call('DELETE', '/api/user/account', { currentPassword: P1 }, C)
ok(cleanup.status === 200, 'cleanup re-created account')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
