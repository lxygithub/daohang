// 内置导航站点库（只读）：分页 + 分类过滤 + 关键词搜索。
// 数据由 scripts/crawl-inftab.mjs 抓取、经 /api/builtin-sites/import 导入。
// 公开只读：站点目录无敏感信息；写入仍需登录 + 导入密钥（见 import.js）。
import { ensureSchema, listBuiltinSites, BUILTIN_CATS } from "../lib/db.js";
import { json } from "../lib/auth.js";

export async function onRequest(context) {
  const { request, env } = context;
  await ensureSchema(env);

  if (request.method !== "GET") return json({ error: "Method Not Allowed" }, { status: 405 });

  const url = new URL(request.url);
  // 公开只读、内容极少变化：命中边缘缓存直接返回（首次 ≈2.5s，之后 ~50ms）。
  // 缓存键是完整 URL，不同筛选/分页互不影响。
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60);
  const cat = String(url.searchParams.get("cat") || "").trim();
  const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
  const pageSize = parseInt(url.searchParams.get("pageSize") || "50", 10) || 50;
  const withCounts = url.searchParams.get("withCounts") === "1";

  if (cat && !BUILTIN_CATS.includes(cat)) return json({ error: "未知分类" }, { status: 400 });

  // 注意：listBuiltinSites 的解构字段名是 qstr，这里直接传 q 会导致关键词永不生效（搜索返回全量）。
  // count（全库总数）与 catCounts（侧栏角标）都并进同一次网关往返，不再各查一次。
  const data = await listBuiltinSites(env, { cat, qstr: q, page, pageSize, withCatCounts: withCounts });
  const res = json({
    ok: true,
    cats: BUILTIN_CATS,
    ...data,
  });
  res.headers.set("Cache-Control", "public, max-age=300, s-maxage=300");
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
