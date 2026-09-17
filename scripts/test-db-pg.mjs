// scripts/test-db-pg.mjs — functions/lib/db.js（PG 网关版）纯逻辑单测，mock fetch 零网络。
// 验证：方言转换（$n 占位符/ON CONFLICT/jsonb_to_recordset）、read-only/read-write 分流、
//       多语句事务合并、20 条/请求分批、D1 返回值适配（first/all/last_row_id）。
import { ensureSchema, getUserByEmail, createUser, upsertUserData, deleteUserCascade,
         upsertBuiltinSites, replaceBuiltinCats, updateBuiltinIcons, listBuiltinSites,
         countBuiltinSites, setUserData } from '../functions/lib/db.js'

// ---- mock 网关 ----
const calls = [] // { url, mode, statements }
let script = []   // 每次网关请求按序弹出响应；耗尽后返回默认空 rows
let defaultReplies = 0
const resetCounters = () => { calls.length = 0; defaultReplies = 0 }
globalThis.fetch = async (_url, init) => {
  const body = JSON.parse(init.body)
  calls.push({ url: _url, mode: body.mode, statements: body.statements })
  const wanted = script.shift()
  const rows = wanted === undefined ? (defaultReplies++, body.statements.map(() => []))
    : Array.isArray(wanted) ? wanted : [wanted]
  if (wanted !== undefined && !Array.isArray(wanted)) throw new Error('mock: 脚本格式须为 rows 数组的数组')
  if (wanted === undefined && body.mode === 'read-write') { /* 默认空结果可接受 */ }
  return {
    ok: true,
    json: async () => ({
      requestId: 'r1', target: 'forgotit-postgres', durationMs: 1,
      results: body.statements.map((_, i) => ({ rows: rows[i] ?? [] })),
    }),
  }
}
const last = () => calls[calls.length - 1]
let pass = 0, fail = 0
const ok = (cond, name) => { cond ? pass++ : (fail++, console.error('  ✗ ' + name)) }
const env = { SQL_GATEWAY_URL: 'https://gw.test/v1/query', SQL_GATEWAY_TARGET: 'forgotit-postgres' }

// 1. ensureSchema 全表在 → 通过
script.push([[{ table_name: 'users' }, { table_name: 'sessions' }, { table_name: 'user_data' },
             { table_name: 'pwd_resets' }, { table_name: 'builtin_sites' }, { table_name: 'builtin_site_cats' }, { table_name: 'nav_config' }]])
await ensureSchema(env)
ok(last().mode === 'read-only', 'ensureSchema 走 read-only')

// 1b. 缺表场景：schemaReady 是模块级缓存，重新加载新实例隔离
script.push([[{ table_name: 'users' }]])
const dbFresh = await import('../functions/lib/db.js?case=missing')
let ensureErr = ''
try { await dbFresh.ensureSchema(env) } catch (e) { ensureErr = e.message }
ok(ensureErr.includes('pg-schema.sql'), '缺表报错指向 pg-schema.sql')

// 2. getUserByEmail：schema 前缀 + $1 + first 适配
script.push([[{ id: 1, email: 'a@b.c', disabled: 0 }]])
const u = await getUserByEmail(env, 'a@b.c')
ok(/FROM daohang\.users WHERE email = \$1$/.test(last().statements[0].sql), 'users 查询 $1+schema 前缀')
ok(u?.email === 'a@b.c', 'first() 行适配')

// 3. createUser：RETURNING id 适配 last_row_id 语义
script.push([[{ id: 42 }]])
ok(await createUser(env, 'a@b.c', 'hash') === 42, 'createUser 返回新 id')
ok(/RETURNING id/.test(last().statements[0].sql) && last().mode === 'read-write', 'RETURNING id + read-write')

// 4. setUserData：ON CONFLICT DO UPDATE
script.push([[]])
await setUserData(env, 1, 'config', '{}', '2026-09-17T00:00:00.000Z')
ok(/ON CONFLICT \(user_id, key\) DO UPDATE/.test(last().statements[0].sql), 'user_data upsert 方言')

// 5. upsertUserData LWW：旧更新时间 → 不写库（仅 1 次读调用）
calls.length = 0
script.push([[{ updated_at: '9999-01-01T00:00:00.000Z' }]])
const lww = await upsertUserData(env, 1, 'config', '{}', '2026-09-17T00:00:00.000Z')
ok(lww.written === false && calls.length === 1, 'LWW 旧值不写库')

// 6. deleteUserCascade：3 条 DELETE 同一请求（同一短事务）
calls.length = 0
script.push([[], [], []])
await deleteUserCascade(env, 7)
ok(last().statements.length === 3 && last().statements.every(s => s.sql.startsWith('DELETE FROM daohang.')), '级联删除单请求 3 语句')

// 7. upsertBuiltinSites：jsonb_to_recordset + 大数组按字节分块
calls.length = 0
await upsertBuiltinSites(env, [{ url: 'u', name: 'n', icon: 'i', iconSrc: '', description: '', rate: 1, sourceId: 's', updatedAt: 't' }])
ok(/jsonb_to_recordset\(\$1::jsonb\)/.test(last().statements[0].sql), '站点 upsert 用 jsonb_to_recordset')
ok(!/OVERRIDING/.test(last().statements[0].sql), 'upsert 不显式插 id')
resetCounters()
await upsertBuiltinSites(env, Array.from({ length: 4000 }, (_, i) => ({ url: 'u' + i, name: 'n', icon: 'x'.repeat(500), iconSrc: '', description: '', rate: 0, sourceId: '', updatedAt: 't' })))
ok(calls.length > 1 && calls.every(c => JSON.stringify(c).length < 300 * 1024), `超大行集分块（4000 行 → ${calls.length} 请求，均低于请求体上限）`)

// 8. replaceBuiltinCats：DELETE+INSERT 同请求
calls.length = 0
script.push([[], []])
await replaceBuiltinCats(env, [{ url: 'u', cat: 'app' }])
ok(last().statements.length === 2 && /jsonb_array_elements_text/.test(last().statements[0].sql)
   && /jsonb_to_recordset/.test(last().statements[1].sql), '分类先清后插同请求')

// 9. updateBuiltinIcons：45 行 → 3 请求（20+20+5）
resetCounters()
await updateBuiltinIcons(env, Array.from({ length: 45 }, (_, i) => ({ url: 'u' + i, icon: 'i', updatedAt: 't' })))
ok(calls.length === 3 && calls[2].statements.length === 5, '图标批量 20 条/请求分批')

// 10. listBuiltinSites：count+list 同请求，cats 第二请求
calls.length = 0
script.push([[{ n: 1 }], [{ id: 9, name: 'N', url: 'u', icon: '', description: '', rate: 3 }]], [[{ site_id: 9, cat: 'app' }]])
const lst = await listBuiltinSites(env, { cat: 'app', q: 'x', page: 2, pageSize: 50 })
ok(calls.length === 2 && calls[0].statements.length === 2, 'count+list 合并一次往返')
ok(calls[1].statements[0].sql.includes('IN ($1)'), 'cats IN($1) 参数化')
ok(lst.total === 1 && lst.items[0].cats[0] === 'app', '分页结果+分类补齐')

// 11. countBuiltinSites
script.push([[{ n: 19626 }]])
ok(await countBuiltinSites(env) === 19626, 'count 适配 Number')

console.log(`\ndb.js PG 版测试：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
