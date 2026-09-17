// 内置导航站点库（只读）：分页 + 分类过滤 + 关键词搜索。
// 数据由 scripts/crawl-inftab.mjs 抓取、经 /api/builtin-sites/import 导入。
// 公开只读：站点目录无敏感信息；写入仍需登录 + 导入密钥（见 import.js）。
import { ensureSchema, listBuiltinSites, countBuiltinSites, builtinCatCounts, BUILTIN_CATS } from "../lib/db.js";
import { json } from "../lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;
  await ensureSchema(env);

  if (request.method !== "GET") return json({ error: "Method Not Allowed" }, { status: 405 });

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60);
  const cat = String(url.searchParams.get("cat") || "").trim();
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = parseInt(url.searchParams.get("pageSize") || "50", 10) || 50;
  const withCounts = url.searchParams.get("withCounts") === "1";

  if (cat && !BUILTIN_CATS.includes(cat)) return json({ error: "未知分类" }, { status: 400 });

  const data = await listBuiltinSites(env, { cat, q, page, pageSize });
  return json({
    ok: true,
    cats: BUILTIN_CATS,
    count: await countBuiltinSites(env),
    // 侧栏分类角标（内置导航弹窗用）：仅显式请求时多跑 1 条 GROUP BY
    ...(withCounts ? { catCounts: await builtinCatCounts(env) } : {}),
    ...data,
  });
}
