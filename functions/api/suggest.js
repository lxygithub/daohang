// GET /api/suggest?q=<关键词> —— 首页搜索框的「搜索词联想」。
//
// 浏览器直连 Google/Bing 的 suggest 接口会被 CORS 拦（它们不返 Access-Control-Allow-Origin），
// 所以由 Worker 在边缘代为请求，再把纯 JSON 返给前端。响应做短时边缘缓存，
// 同一个词在热门时段不重复回源。
//
// 只做「搜索词建议」——返回的是 ["gta5", "gta online", ...] 这类补全词，
// 与 /api/site-suggest 的「站点/域名」完全不同，两者在首页联想里合并展示、分组标注。
import { json } from "../lib/auth.js";

const MAX = 8;
const TIMEOUT = 3500;

// 顺序即兜底优先级：Google 词质量高，国内词用 Bing 的中文市场补齐
const SOURCES = [
  (q) => `https://suggestqueries.google.com/complete/search?client=firefox&hl=zh-CN&q=${encodeURIComponent(q)}`,
  (q) => `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}&market=zh-CN`,
];

function cleanWord(w) {
  return String(w || "").replace(/\s+/g, " ").trim().slice(0, 60);
}

async function fetchSuggest(url) {
  const res = await fetch(url, {
    headers: {
      // 不带 UA 时部分源会直接 403
      "user-agent": "Mozilla/5.0 (compatible; daohang-suggest/1.0)",
      accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) return [];
  // Google(firefox client) 与 Bing(osjson) 都是 [query, [suggestions]]
  const data = await res.json().catch(() => null);
  const list = Array.isArray(data) ? data[1] : null;
  if (!Array.isArray(list)) return [];
  return list.map(cleanWord).filter(Boolean);
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method !== "GET") return json({ error: "Method Not Allowed" }, { status: 405 });

  const url = new URL(request.url);
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 60);
  if (!q) return json({ ok: true, q: "", suggestions: [] });

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/suggest?q=${encodeURIComponent(q)}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let suggestions = [];
  for (const build of SOURCES) {
    try {
      suggestions = await fetchSuggest(build(q));
      if (suggestions.length) break;
    } catch {
      // 单个源超时/被墙就换下一个，全部失败则返回空数组
    }
  }

  const res = json({
    ok: true,
    q,
    suggestions: [...new Set(suggestions)].slice(0, MAX),
  });
  res.headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
