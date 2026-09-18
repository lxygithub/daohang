#!/usr/bin/env node
// 清洗内置站点库里爬来的脏名字/描述。
//
// 背景：数据源（inftab）自己的 name 字段里就混进了 HTML 碎片——例如
//   `知乎 - 有问题上知乎</title><meta data-react-helmet="true" name="keyw`
// （crawl-inftab.mjs 只做了 trim + 空白归一 + slice(0,60)，没做去标签）。
// 另外还有 HTML 实体（`News &amp; Revie`）和一批 SEO 堆词的超长标题
// （`艾薇百科 | 共享精品软件|分享电脑技术|dlink路由器初始密码|...`）。
//
// 清洗规则（保守，不做「一律硬截断」）：
//   1) 名字里出现 `<` → 从这里截断（HTML 碎片都是附在真标题后面的）；
//   2) 解 HTML 实体（&amp; &#39; 等）；
//   3) 空白归一 + 去首尾；
//   4) 名字本身就是网址 → 换成域名；
//   5) 超过 30 字且前 30 字内出现分隔符（" - " / " | " / " · " …）→ 取分隔符前的部分
//      （`Stack Overflow - Where Developers Learn…` → `Stack Overflow`）；
//      没有分隔符的长标题**保持原样**——那是站点真实标题，卡片本来就会省略号截断，
//      不做不可逆的硬砍。
//   6) 清洗后为空 → 退回域名。
//   7) 含替换字符 U+FFFD（源数据被截断/编码错乱，原字已不可恢复，实测 16 条）→ 名字改用域名，
//      描述直接去掉乱码。宁可显示域名，也别在卡片上留一串 ���。
// 描述只做 1~4，不缩短。
//
// 用法：
//   node scripts/clean-builtin-names.mjs            # 干跑：打印统计 + 抽样，写 SQL 与备份
//   node scripts/clean-builtin-names.mjs --apply    # 执行（先自动备份整表）
//
// 产物（scripts/data/，已 gitignore）：
//   clean-names.sql           UPDATE 语句（带 `AND name = '<原值>'` 守卫，幂等可重跑）
//   clean-names-backup.json   id → { name, description } 原值，出事可回滚
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(DIR, "data");
const SQL_FILE = path.join(DATA, "clean-names.sql");
const BACKUP_FILE = path.join(DATA, "clean-names-backup.json");

const CONTAINER = "forgotit-postgres";
const PG_USER = "forgotit";
const PG_DB = "daohang";
const TABLE = "daohang.builtin_sites";

const MAX_NAME = 30;
const SEPARATORS = [" - ", " | ", " — ", " – ", " · ", " :: ", " » ", " _ "];
const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

const apply = process.argv.includes("--apply");
const psql = (sql, { tuples = true } = {}) =>
  execFileSync(
    "docker",
    ["exec", "-i", CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB, "-t", "-A", ...(tuples ? ["-F", "\u0001"] : []), "-c", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } };

/** 找「品牌名分隔符」的位置（" - " / " | " / " · " …），找不到返回 -1。
 *  只认前 MAX_NAME 个字以内、且前面至少 3 个字的分隔符——否则切出来太短没意义。 */
function separatorCut(s) {
  let cut = -1;
  for (const sep of SEPARATORS) {
    const i = s.indexOf(sep);
    if (i >= 3 && i <= MAX_NAME && (cut < 0 || i < cut)) cut = i;
  }
  return cut;
}

const decodeEntities = (s) =>
  s.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] || m)
   .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(Number(d)) } catch { return m } })
   .replace(/&#x([0-9a-f]+);/gi, (m, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return m } });

/** 返回 { name, rules: [] }；rules 记录命中了哪些规则，便于统计 */
function cleanName(raw, url, { shorten = true, fallbackHost = true } = {}) {
  const rules = [];
  let s = String(raw ?? "");
  const host = hostOf(url);

  // 只在 `<` 后面跟着标签特征时才截断（`</title>` `<meta` `<!--`）：`WebHome < Main < TWiki`
  // 这种拿 `<` 当分隔符的真标题不能被误砍。
  const lt = s.search(/<\/?[a-zA-Z!/]/);
  if (lt >= 0) { s = s.slice(0, lt); rules.push("去HTML碎片"); }

  const decoded = decodeEntities(s);
  if (decoded !== s) { s = decoded; rules.push("解实体"); }

  const squeezed = s.replace(/\s+/g, " ").trim();
  if (squeezed !== s) { s = squeezed; rules.push("空白归一"); }

  if (/^https?:\/\//i.test(s)) {
    const h = hostOf(s) || host;
    if (h) { s = h; rules.push("网址换域名"); }
  }

  // 超长且能靠分隔符取到品牌名 → 取前缀（仅在没命中前面规则时统计，避免重复计数）
  const beforeCut = s;
  if (shorten && [...s].length > MAX_NAME) {
    const cut = separatorCut(s);
    if (cut > 0) s = s.slice(0, cut).trim();
  }
  if (s !== beforeCut) rules.push("取品牌名");

  // 乱码（U+FFFD）：原字已丢。能靠分隔符留下干净前缀就用前缀（`Minecraft Wiki — офици�`
  // → `Minecraft Wiki`），否则名字用域名顶替、描述直接去掉乱码。
  if (s.includes("\uFFFD")) {
    if (shorten) {
      const cut = separatorCut(s);
      const prefix = cut > 0 ? s.slice(0, cut).trim() : "";
      if (prefix.length >= 3 && !prefix.includes("\uFFFD")) { s = prefix; rules.push("乱码取前缀"); }
      else if (host) { s = host; rules.push("乱码换域名"); }
      else { s = s.replace(/\uFFFD+/g, "").trim(); rules.push("去乱码"); }
    } else {
      // 描述：去掉乱码后要把残留的空白重新归一（否则要跑第二遍才干净）。
      // 如果大半内容都是乱码（如俄文描述整段丢字），剩下的碎片没意义，直接清空。
      const stripped = s.replace(/\uFFFD+/g, "");
      const removed = s.length - stripped.length;
      if (s.length && removed / s.length >= 0.3) { s = ""; rules.push("乱码清空"); }
      else { s = stripped.replace(/\s+/g, " ").trim(); rules.push("去乱码"); }
    }
  }

  // 只有「名字」需要兜底：名字空了卡片就没字了。描述空了就保持空，别填成域名。
  if (!s && fallbackHost) { s = host || String(raw ?? "").trim(); if (s) rules.push("回退域名"); }
  return { name: s, rules };
}

function cleanText(raw, url) {
  // 描述只做去标签 / 解实体 / 空白归一 / 网址换域名，不做第 5 步的缩短（描述本来就是长句）
  const { name } = cleanName(raw, url, { shorten: false, fallbackHost: false });
  // 再丢掉噪声描述：只剩标点/数字/表情，或有效字母不足 2 个（乱码清洗后的残渣正是这样）
  if (name && (name.match(/\p{L}/gu) || []).length < 2) return "";
  return name;
}

// ---- 拉数据 ----
const rows = psql(`SELECT id, name, COALESCE(description, ''), url FROM ${TABLE} ORDER BY id`)
  .trim().split("\n").filter(Boolean).map((line) => {
    const [id, name, description, url] = line.split("\u0001");
    return { id: Number(id), name, description, url };
  });
console.log(`共 ${rows.length} 行`);

const esc = (s) => String(s).replace(/'/g, "''");
const tally = {};
const changed = [];
const backup = [];

for (const r of rows) {
  const { name: newName, rules } = cleanName(r.name, r.url);
  const newDesc = cleanText(r.description, r.url);
  const nameChanged = newName !== r.name;
  const descChanged = newDesc !== r.description;
  if (!nameChanged && !descChanged) continue;
  for (const k of rules) tally[k] = (tally[k] || 0) + 1;
  if (nameChanged) tally["名字改动"] = (tally["名字改动"] || 0) + 1;
  if (descChanged) tally["描述改动"] = (tally["描述改动"] || 0) + 1;
  backup.push({ id: r.id, name: r.name, description: r.description });
  const sets = [];
  if (nameChanged) sets.push(`name = '${esc(newName)}'`);
  if (descChanged) sets.push(`description = '${esc(newDesc)}'`);
  const guards = [`id = ${r.id}`];
  if (nameChanged) guards.push(`name = '${esc(r.name)}'`);
  if (descChanged) guards.push(`COALESCE(description,'') = '${esc(r.description)}'`);
  changed.push({ id: r.id, from: r.name, to: newName, rules });
  changed[changed.length - 1].sql = `UPDATE ${TABLE} SET ${sets.join(", ")} WHERE ${guards.join(" AND ")};`;
}

console.log("\n命中规则统计：", JSON.stringify(tally, null, 1));
console.log(`\n需要改动 ${changed.length} 行`);

const sample = (key, n = 6) => {
  const list = changed.filter((c) => c.rules.includes(key)).slice(0, n);
  if (!list.length) return;
  console.log(`\n【${key}】示例：`);
  for (const c of list) console.log(`  ${c.from.slice(0, 46)}\n   → ${c.to}`);
};
["去HTML碎片", "解实体", "网址换域名", "取品牌名"].forEach((k) => sample(k));

fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(BACKUP_FILE, JSON.stringify(backup, null, 1));
fs.writeFileSync(SQL_FILE, `BEGIN;\n${changed.map((c) => c.sql).join("\n")}\nCOMMIT;\n`);
console.log(`\nSQL → ${SQL_FILE}（${changed.length} 条）`);
console.log(`原值备份 → ${BACKUP_FILE}（${backup.length} 行，回滚用）`);

if (!apply) {
  console.log("\n（干跑结束；加 --apply 执行）");
  process.exit(0);
}

console.log("\n▶ 执行…");
execFileSync("docker", ["exec", "-i", CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
  { input: fs.readFileSync(SQL_FILE, "utf8"), stdio: ["pipe", "inherit", "inherit"] });

// 复核：再算一遍，应该 0 行需要改
const after = psql(`SELECT id, name, COALESCE(description, ''), url FROM ${TABLE} ORDER BY id`)
  .trim().split("\n").filter(Boolean).map((l) => l.split("\u0001"));
let left = 0;
for (const [id, name, description, url] of after) {
  const { name: n2 } = cleanName(name, url);
  const d2 = cleanText(description, url);
  if (n2 !== name || d2 !== description) {
    left++;
    if (left <= 5) console.log(`  · id=${id} 名字「${name}」→「${n2}」 描述「${description.slice(0, 40)}」→「${d2.slice(0, 40)}」`);
  }
}
console.log(`复核：仍有 ${left} 行可清洗（应为 0）`);
