// scripts/test-gateway.mjs — functions/lib/gateway.js 纯逻辑单测（零网络）。
// 验证指南坑 1 的 BigInt 处置与协议上限前置校验；错误分支均不触网。
import { gatewayQuery, firstRow } from '../functions/lib/gateway.js'

let pass = 0, fail = 0
const expect = (cond, name) => { cond ? pass++ : (fail++, console.error('  ✗ ' + name)) }
const expectThrow = async (fn, frag, name) => {
  try { await fn(); expect(false, name + '（未抛错）') }
  catch (e) { expect(e.message.includes(frag), `${name} → "${e.message.slice(0, 80)}"` ) }
}

// 1. 未配置 SQL_GATEWAY_URL → 明确错误，而非 fetch(undefined)
await expectThrow(() => gatewayQuery({}, 't', 'read-only', [{ sql: 'SELECT 1' }]),
  'NOT_CONFIGURED', '缺 URL 报 NOT_CONFIGURED')

// 2. 空 statements / 超 20 条 → 前置校验
await expectThrow(() => gatewayQuery({ SQL_GATEWAY_URL: 'http://x' }, 't', 'read-only', []),
  '不能为空', '空 statements 拒绝')
await expectThrow(() => gatewayQuery({ SQL_GATEWAY_URL: 'http://x' }, 't', 'read-only',
  Array.from({ length: 21 }, (_, i) => ({ sql: 'SELECT 1' }))),
  '最多 20 条', '21 条语句拒绝')

// 3. 超 256 KiB 请求体 → 前置校验（不触网）
await expectThrow(() => gatewayQuery({ SQL_GATEWAY_URL: 'http://x' }, 't', 'read-only',
  [{ sql: 'SELECT $1', params: ['x'.repeat(300 * 1024)] }]),
  '256 KiB', '超大请求体拒绝')

// 4. BigInt 参数不再炸序列化（指南坑 1）：走到 fetch 才失败 → UNREACHABLE 而非 TypeError
await expectThrow(() => gatewayQuery({ SQL_GATEWAY_URL: 'http://127.0.0.1:1' }, 't', 'read-only',
  [{ sql: 'SELECT $1', params: [123n] }]),
  'UNREACHABLE', 'BigInt 参数通过序列化')

// 5. firstRow 收口
expect(firstRow({ results: [{ rows: [{ a: 1 }] }] })?.a === 1, 'firstRow 取首行')
expect(firstRow({ results: [] }) === null, 'firstRow 空结果为 null')
expect(firstRow(undefined) === null, 'firstRow 容错 undefined')

console.log(`\ngateway.js 纯逻辑测试：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
