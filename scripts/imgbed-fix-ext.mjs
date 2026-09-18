#!/usr/bin/env node
// 把图床里"非标准后缀"的文件重传成标准后缀，并改掉引用。
//
// 背景：9-16 号那批图标是用旧逻辑转存的，把 MIME 子类型直接当后缀用，于是出现
//   image/x-icon            → .xicon
//   image/vnd.microsoft.icon → .vndmicrosofticon
//   image/svg+xml           → .svgxml
// Cloudflare 默认只缓存常见图片后缀，这些后缀的响应是 `cf-cache-status: DYNAMIC`
// ——每张都要回源到家里 Cloudreve（国内单张 2~3s）。新逻辑已修正（见 functions/lib/rehost.js），
// 这个脚本只处理历史遗留的 18 个文件。
//
// 用法：
//   IMG_ADMIN_SESSION=<图床 admin_session> node scripts/imgbed-fix-ext.mjs            # 干跑：只列清单
//   IMG_ADMIN_SESSION=... CF_API_TOKEN=... node scripts/imgbed-fix-ext.mjs --apply    # 下载→重传→改库→删旧
//
// 产物（scripts/data/，已 gitignore）：imgbed-fix-ext.json（旧 id → 新外链）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(DIR, "data");
const MAP_FILE = path.join(DATA, "imgbed-fix-ext.json");
const SQL_FILE = path.join(DATA, "imgbed-fix-ext.sql");

const AID = "d16192780cbd7ffa633f1e699a83dee8";
const IMG_D1 = "5e5668e7-4d51-489f-a540-1e1ea931dc1c";
const D1_API = `https://api.cloudflare.com/client/v4/accounts/${AID}/d1/database/${IMG_D1}/query`;
const IMG_BASE = "https://img-bed.ieoc.top";

const TOKEN = String(process.env.IMG_ADMIN_SESSION || "").trim();
const CF_TOKEN = String(process.env.CF_API_TOKEN || "").trim();
const apply = process.argv.includes("--apply");

// 与 functions/lib/rehost.js 保持一致的 MIME → 后缀映射
const EXT_BY_MIME = {
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const BAD_EXT = /\.(xicon|vndmicrosofticon|svgxml)$/i;

async function d1(sql) {
  const res = await fetch(D1_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const j = await res.json();
  if (!j.success) throw new Error("D1 error: " + JSON.stringify(j.errors).slice(0, 200));
  return j.result[0]?.results ?? [];
}

// 找出需要修的文件（没有 CF token 时退回读上次的结果文件清单）
async function collect() {
  if (CF_TOKEN) {
    return d1(
      `SELECT id FROM files WHERE id LIKE '%.xicon' OR id LIKE '%.vndmicrosofticon' OR id LIKE '%.svgxml' ORDER BY id`
    ).then((rows) => rows.map((r) => r.id));
  }
  const cached = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : null;
  if (cached) return Object.keys(cached);
  throw new Error("需要 CF_API_TOKEN（有 D1 读权限），或先跑一次生成 " + MAP_FILE);
}

async function upload(buf, name, type) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type }), name);
  const res = await fetch(`${IMG_BASE}/upload`, {
    method: "POST",
    headers: { cookie: `admin_session=${TOKEN}` },
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`上传失败 HTTP ${res.status} ${text.slice(0, 160)}`);
  const m = text.match(/"publicUrl":"([^"]+)"/) || text.match(/"src":"([^"]+)"/);
  if (!m) throw new Error("上传响应解析不出地址：" + text.slice(0, 160));
  return m[1].startsWith("http") ? m[1] : IMG_BASE + m[1];
}

const psql = (sql) =>
  execFileSync(
    "docker",
    ["exec", "-i", "forgotit-postgres", "psql", "-U", "forgotit", "-d", "daohang", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
    { encoding: "utf8" }
  );

const ids = await collect();
console.log(`待修文件 ${ids.length} 个`);
if (!ids.length) process.exit(0);
if (!apply) {
  ids.forEach((id) => console.log("  ·", id));
  console.log("\n（干跑结束；加 --apply 执行：下载 → 重传 → 改库 → 删旧）");
  process.exit(0);
}
if (!TOKEN) {
  console.error("缺少 IMG_ADMIN_SESSION");
  process.exit(1);
}

// 1) 下载 + 重传
const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8")) : {};
for (const id of ids) {
  if (map[id]) { console.log(`  跳过（已处理）${id}`); continue; }
  const res = await fetch(`${IMG_BASE}/file/${id}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) { console.error(`  ✗ 下载失败 ${res.status} ${id}`); continue; }
  const ct = (res.headers.get("content-type") || "").split(";")[0].trim();
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ct.startsWith("image/")) { console.error(`  ✗ 非图片 ${ct} ${id}`); continue; }
  const ext = EXT_BY_MIME[ct] || ct.split("/")[1].replace(/[^a-z0-9]/g, "");
  // 用「原时间戳 + icon.<新后缀>」命名，保持可追溯
  const stamp = (id.split("/").pop() || "").split("_")[0];
  const name = `${stamp}_icon.${ext}`;
  const url = await upload(buf, name, ct);
  map[id] = { url, from: ct, bytes: buf.byteLength };
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));
  console.log(`  ✓ ${id}  →  ${url.split("/").pop()}（${ct}，${buf.byteLength}B）`);
}

// 2) 改引用：站点配置 + 内置站点库（实测内置库没引用，这里一并覆盖）
const pairs = Object.entries(map).filter(([, v]) => v.url);
const esc = (s) => String(s).replace(/'/g, "''");
const expr = (col) => pairs.reduce((acc, [oldId, v]) => acc.replace(`'${oldId}'`, `'${v.url.replace(IMG_BASE + "/file/", "")}'`), col);
const setExpr = (col) =>
  pairs.reduce(
    (acc, [oldId, v]) => `replace(${acc}, '${esc(IMG_BASE + "/file/" + oldId)}', '${esc(v.url)}')`,
    col
  );

const sql = [
  "BEGIN;",
  `UPDATE daohang.user_data SET value = ${setExpr("value")}, updated_at = now()::text WHERE key = 'config' AND value LIKE '%${esc(IMG_BASE + "/file/")}%';`,
  `UPDATE daohang.builtin_sites SET icon = ${setExpr("icon")} WHERE icon LIKE '${esc(IMG_BASE + "/file/")}%';`,
  "COMMIT;",
].join("\n");
fs.writeFileSync(SQL_FILE, sql + "\n");
console.log(`\nSQL → ${SQL_FILE}`);

console.log("▶ 改库…");
psql(sql);

// 3) 删旧文件（改完引用再删，避免中途失败留下断链）
console.log("▶ 删除旧文件…");
const del = await fetch(`${IMG_BASE}/api/manage/delete/batch`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `admin_session=${TOKEN}` },
  body: JSON.stringify({ fileIds: ids }),
  signal: AbortSignal.timeout(120000),
});
console.log("  删除结果：", (await del.text()).slice(0, 200));

// 4) 自检：新外链是否都 200
let ok = 0, bad = [];
for (const [, v] of pairs) {
  const r = await fetch(v.url, { method: "GET", signal: AbortSignal.timeout(30000) });
  if (r.ok) ok++; else bad.push(v.url);
}
console.log(`\n自检：新外链 ${ok}/${pairs.length} 返回 200${bad.length ? "，失败：" + bad.join(", ") : ""}`);
