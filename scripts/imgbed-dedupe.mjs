#!/usr/bin/env node
// 图床 builtin-icons 去重扫描（只读，不写 D1）
//
// 背景：图床里同名内容被多轮上传重复存储——sha1 命名的文件本身就带内容指纹，
// 但「旧命名」（icon_<时间戳>_<随机>.png）的元数据里没有哈希，只能下载后自己算。
//
// 用法：
//   CF_API_TOKEN=xxx node scripts/imgbed-dedupe.mjs scan [--conc=24] [--budget=300]
//   CF_API_TOKEN=xxx node scripts/imgbed-dedupe.mjs report
//
// 产物（scripts/data/）：
//   imgbed-files.json       从 D1 拉到的全量文件清单
//   imgbed-content-hash.json 文件名 → sha1（增量落盘，可反复跑直到补齐）
//   imgbed-dedupe-report.json 重复报告（含可删除清单，已排除数据库引用的文件）

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(DIR, 'data')
const FILES = path.join(DATA, 'imgbed-files.json')
const HASHES = path.join(DATA, 'imgbed-content-hash.json')
const REPORT = path.join(DATA, 'imgbed-dedupe-report.json')
const PROTECTED = path.join(DATA, 'db-referenced-ids.txt')

const AID = 'd16192780cbd7ffa633f1e699a83dee8'
const IMG_D1 = '5e5668e7-4d51-489f-a540-1e1ea931dc1c'
const API = `https://api.cloudflare.com/client/v4/accounts/${AID}/d1/database/${IMG_D1}/query`
const BASE = 'https://img-bed.ieoc.top/file/'

const args = process.argv.slice(2)
const cmd = args[0] || 'report'
const getArg = (name, def) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? def

// sha1 命名的文件（<40位十六进制>.png）文件名本身就是内容指纹，无需下载
const isSha1Name = fn => /^[0-9a-f]{40}\.png$/.test(fn)

async function d1(sql) {
  const token = process.env.CF_API_TOKEN
  if (!token) throw new Error('缺少 CF_API_TOKEN 环境变量')
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql }),
  })
  const j = await res.json()
  if (!j.success) throw new Error('D1 error: ' + JSON.stringify(j.errors).slice(0, 200))
  return j.result[0]?.results ?? []
}

async function fetchFileList() {
  const rows = []
  for (let off = 0; ; off += 10000) {
    const page = await d1(`SELECT id, file_name, json_extract(metadata,'$.FileSizeBytes') AS sz,
                                  json_extract(metadata,'$.Channel') AS ch, timestamp
                             FROM files WHERE directory LIKE '%builtin-icons%'
                            ORDER BY id LIMIT 10000 OFFSET ${off}`)
    rows.push(...page)
    if (page.length < 10000) break
  }
  fs.writeFileSync(FILES, JSON.stringify(rows))
  return rows
}

async function scan() {
  const conc = parseInt(getArg('conc', '24'), 10)
  const budgetMs = parseInt(getArg('budget', '600'), 10) * 1000
  const files = fs.existsSync(FILES) ? JSON.parse(fs.readFileSync(FILES, 'utf8')) : await fetchFileList()
  console.log(`文件清单 ${files.length} 条`)
  const hashes = fs.existsSync(HASHES) ? JSON.parse(fs.readFileSync(HASHES, 'utf8')) : {}
  for (const f of files) if (isSha1Name(f.file_name)) hashes[f.id] = f.file_name.slice(0, 40)
  const todo = files.filter(f => !hashes[f.id])
  console.log(`已有指纹 ${Object.keys(hashes).length}，待下载 ${todo.length}`)
  if (!todo.length) return
  const t0 = Date.now()
  let ok = 0, fail = 0, idx = 0
  const worker = async () => {
    while (idx < todo.length && Date.now() - t0 < budgetMs) {
      const f = todo[idx++]
      try {
        const r = await fetch(BASE + f.id)
        if (!r.ok) { fail++; continue }
        const buf = Buffer.from(await r.arrayBuffer())
        hashes[f.id] = createHash('sha1').update(buf).digest('hex')
        ok++
        if (ok % 200 === 0) {
          fs.writeFileSync(HASHES, JSON.stringify(hashes))
          console.log(`  已下载 ${ok}（${((Date.now() - t0) / 1000).toFixed(0)}s）`)
        }
      } catch { fail++ }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker))
  fs.writeFileSync(HASHES, JSON.stringify(hashes))
  console.log(`本轮完成：成功 ${ok}｜失败 ${fail}｜剩余 ${todo.length - ok - fail}｜指纹总数 ${Object.keys(hashes).length}`)
}

function report() {
  const files = JSON.parse(fs.readFileSync(FILES, 'utf8'))
  const hashes = JSON.parse(fs.readFileSync(HASHES, 'utf8'))
  const protectedIds = new Set(fs.existsSync(PROTECTED) ? fs.readFileSync(PROTECTED, 'utf8').split('\n').filter(Boolean) : [])
  const byHash = new Map()
  let unknown = 0
  for (const f of files) {
    const h = hashes[f.id]
    if (!h) { unknown++; continue }
    if (!byHash.has(h)) byHash.set(h, [])
    byHash.get(h).push(f)
  }
  const groups = [...byHash.entries()].filter(([, list]) => list.length > 1)
  let deletable = 0, keptProtected = 0
  const plan = []
  for (const [h, list] of groups) {
    // 保留优先级：数据库引用的 > sha1 命名 > 时间戳最早
    const sorted = [...list].sort((a, b) => {
      const pa = protectedIds.has(a.id) ? 0 : 1, pb = protectedIds.has(b.id) ? 0 : 1
      if (pa !== pb) return pa - pb
      const sa = isSha1Name(a.file_name) ? 0 : 1, sb = isSha1Name(b.file_name) ? 0 : 1
      if (sa !== sb) return sa - sb
      return (a.timestamp || 0) - (b.timestamp || 0)
    })
    const keep = sorted[0]
    if (protectedIds.has(keep.id)) keptProtected++
    for (const f of sorted.slice(1)) {
      if (protectedIds.has(f.id)) { keptProtected++; continue } // 被库引用的一律不删
      plan.push({ hash: h, delete: f.id, keep: keep.id, channel: f.ch, size: f.sz })
      deletable++
    }
  }
  const out = {
    生成时间: new Date().toISOString(),
    文件总数: files.length,
    已知指纹: Object.keys(hashes).length,
    指纹未知: unknown,
    不同内容数: byHash.size,
    重复组数: groups.length,
    可删除文件数: deletable,
    保守跳过_库引用: keptProtected,
    可删除清单: plan,
  }
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 1))
  console.log(`文件总数 ${out.文件总数}｜指纹未知 ${unknown}｜不同内容 ${out.不同内容数}｜重复组 ${groups.length}`)
  console.log(`可删除 ${deletable} 个（其中因被数据库引用而跳过 ${keptProtected} 个）→ ${REPORT}`)
}

if (cmd === 'scan') await scan()
else if (cmd === 'report') report()
else console.log('用法: node scripts/imgbed-dedupe.mjs scan|report [--conc=24] [--budget=600]')
