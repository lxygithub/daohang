#!/usr/bin/env node
// 按去重报告批量删除图床里的重复文件
//
// 前置：
//   1) 先跑 scan + report：
//        CF_API_TOKEN=xxx node scripts/imgbed-dedupe.mjs scan
//        node scripts/imgbed-dedupe.mjs report
//      报告里的「可删除清单」已经排除了被数据库引用的文件（保守策略）。
//   2) 需要一个图床管理端会话（浏览器登录态的 admin_session Cookie 值）：
//        IMG_ADMIN_SESSION=<cookie 值> node scripts/imgbed-dedupe-delete.mjs --limit=20
//      Cookie 值也能从图床 D1 的 settings 表里取：key = manage@session@<token>，取 authType=admin 且未过期的那条。
//
// 用法：
//   IMG_ADMIN_SESSION=xxx node scripts/imgbed-dedupe-delete.mjs                # 删除清单里的全部
//   IMG_ADMIN_SESSION=xxx node scripts/imgbed-dedupe-delete.mjs --limit=20     # 只删前 20 个（先验证）
//   IMG_ADMIN_SESSION=xxx node scripts/imgbed-dedupe-delete.mjs --dry-run      # 只打印不删除
//
// 说明：删除会同时清掉图床索引与后端实体（Cloudreve/Telegram）。删除后公开 URL 可能仍命中
// Cloudflare 边缘缓存（file/* 的 max-age 很长），加缓存穿透参数访问即可确认实体已删（404）。
import fs from 'node:fs'

const REPORT = 'scripts/data/imgbed-dedupe-report.json'
const RESULT = 'scripts/data/imgbed-delete-result.json'
const API = 'https://img-bed.ieoc.top/api/manage/delete/batch'
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || 0)
// 图床接口单次上限 500，但它内部并发 10 个删除会撞 D1 写锁（实测约一半失败），
// 所以默认用更小的批次，必要时 --batch=50 之类的再调小。
const BATCH_SIZE = Math.max(1, Math.min(500, Number(args.find((a) => a.startsWith('--batch='))?.split('=')[1] || 200)))
// 批次之间的间隔；接口内部并发删除会撞 D1 写锁，放慢一点能明显提高成功率
const SLEEP_MS = Math.max(0, Number(args.find((a) => a.startsWith('--sleep='))?.split('=')[1] || 500))
const token = String(process.env.IMG_ADMIN_SESSION || '').trim()

if (!dryRun && !token) {
  console.error('缺少 IMG_ADMIN_SESSION（图床管理端 admin_session Cookie 值）')
  process.exit(1)
}

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'))
// 已删过的（上次执行留下的记录）跳过，避免重复请求和假失败
const doneBefore = new Set(
  fs.existsSync(RESULT) ? (JSON.parse(fs.readFileSync(RESULT, 'utf8')).已删除 || []) : [],
)
const plan = (report.可删除清单 || []).map((p) => p.delete).filter((id) => !doneBefore.has(id))
const ids = limit > 0 ? plan.slice(0, limit) : plan
console.log(`报告可删除 ${plan.length} 个，本次处理 ${ids.length} 个${dryRun ? '（dry-run）' : ''}`)
if (dryRun) {
  console.log('前 5 个：', ids.slice(0, 5))
  process.exit(0)
}

const deleted = []
const failed = []
// 每批结束就落盘，中途中断也不会丢「已删除」记录（否则重跑会拿已删文件去撞失败）
const save = () => {
  fs.writeFileSync(
    RESULT,
    JSON.stringify(
      {
        执行时间: new Date().toISOString(),
        成功: deleted.length,
        失败: failed.length,
        失败明细: failed,
        已删除: [...doneBefore, ...deleted],
      },
      null,
      1,
    ),
  )
}
for (let i = 0; i < ids.length; i += BATCH_SIZE) {
  const batch = ids.slice(i, i + BATCH_SIZE)
  let attempt = 0
  let ok = false
  while (attempt < 3 && !ok) {
    attempt++
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `admin_session=${token}` },
        body: JSON.stringify({ fileIds: batch }),
        signal: AbortSignal.timeout(120_000),
      })
      const data = await res.json()
      if (!res.ok || !Array.isArray(data.deleted)) throw new Error(`HTTP ${res.status} ${JSON.stringify(data).slice(0, 120)}`)
      deleted.push(...data.deleted)
      for (const f of data.failed || []) failed.push(f)
      ok = true
      console.log(
        `  批次 ${i / BATCH_SIZE + 1}：删除 ${data.deleted.length}，失败 ${(data.failed || []).length}（累计成功 ${deleted.length}）`,
      )
    } catch (e) {
      console.error(`  批次 ${i / BATCH_SIZE + 1} 第 ${attempt} 次失败：${e.message}`)
      if (attempt === 3) failed.push(...batch.map((id) => ({ fileId: id, error: e.message })))
    }
  }
  save()
  if (SLEEP_MS && i + BATCH_SIZE < ids.length) await new Promise((r) => setTimeout(r, SLEEP_MS))
}

save()
console.log(`完成：成功 ${deleted.length}，失败 ${failed.length} → ${RESULT}`)
