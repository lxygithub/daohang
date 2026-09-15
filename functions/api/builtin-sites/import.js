// 内置导航站点库导入（维护通道）。
//
// 门禁「部署即凭据」：仓库公开、本机无 wrangler/CF 凭据，故把随机导入密钥
// 放 wrangler.toml [vars]（BUILTIN_IMPORT_KEY），随代码部署生效；导入完成后
// 立即提交 disarm 提交移除该密钥。密钥暴露窗口 ≈ 导入窗口（分钟级），且该端点
// 只能写 builtin_sites / builtin_site_cats 两表（字段校验 + 行数上限），被滥用
// 的最坏影响是站点库内容被污染，重新导入即可恢复。
//
// 协议：POST JSON
//   { "key": "<BUILTIN_IMPORT_KEY>",
//     "sites": [ { url, name, icon, iconSrc, description, rate, sourceId, cats: [] }, ... ] }
// 单请求 ≤ 150 条；全表 ≤ 60000 条；url 唯一，重复导入为 upsert（幂等）。
import { ensureSchema, upsertBuiltinSites, replaceBuiltinCats, countBuiltinSites, BUILTIN_CATS } from "../../lib/db.js";
import { json, timingSafeEqual, nowISO } from "../../lib/auth.js";

const MAX_PER_REQUEST = 150;
const MAX_TOTAL = 60000;

function cleanStr(v, max) {
  const s = String(v == null ? "" : v).trim().replace(/\s+/g, " ");
  return s.slice(0, max);
}

function validUrl(u) {
  try {
    const d = new URL(u);
    return /^https?:$/.test(d.protocol) && d.hostname.includes(".") ? d : null;
  } catch { return null }
}

export async function onRequest(context) {
  const { request, env } = context;
  await ensureSchema(env);

  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, { status: 405 });

  const expected = String(env.BUILTIN_IMPORT_KEY || "").trim();
  if (!expected) return json({ error: "导入通道未开启（BUILTIN_IMPORT_KEY 未配置）" }, { status: 404 });
  const got = String(request.headers.get("x-import-key") || "");
  if (!got || got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return json({ error: "导入密钥不匹配" }, { status: 403 });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "无效 JSON" }, { status: 400 }); }
  const list = Array.isArray(body?.sites) ? body.sites : [];
  if (!list.length) return json({ error: "sites 为空" }, { status: 400 });
  if (list.length > MAX_PER_REQUEST) return json({ error: `单请求最多 ${MAX_PER_REQUEST} 条` }, { status: 413 });

  const rows = [];
  const catPairs = [];
  for (const it of list) {
    const u = validUrl(String(it?.url || ""));
    if (!u) continue;
    const name = cleanStr(it.name, 60);
    if (!name) continue;
    const cats = Array.isArray(it.cats)
      ? [...new Set(it.cats.map(c => String(c).trim()))].filter(c => BUILTIN_CATS.includes(c))
      : [];
    rows.push({
      url: u.href,
      name,
      icon: cleanStr(it.icon, 500),
      iconSrc: cleanStr(it.iconSrc, 500),
      description: cleanStr(it.description, 200),
      rate: Math.max(0, parseInt(it.rate, 10) || 0),
      sourceId: cleanStr(it.sourceId, 64),
      updatedAt: nowISO(),
    });
    for (const c of cats) catPairs.push({ url: u.href, cat: c });
  }
  if (!rows.length) return json({ error: "无有效条目（url/name 校验未通过）" }, { status: 422 });

  const total = await countBuiltinSites(env);
  if (total > MAX_TOTAL) return json({ error: `站点库已达上限 ${MAX_TOTAL} 条` }, { status: 409 });
  if (total + rows.length > MAX_TOTAL + 500) return json({ error: "超出全表上限" }, { status: 409 });

  await upsertBuiltinSites(env, rows);
  if (catPairs.length) await replaceBuiltinCats(env, catPairs);

  return json({ ok: true, accepted: rows.length, total: await countBuiltinSites(env) });
}
