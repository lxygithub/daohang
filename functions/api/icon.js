// GET /api/icon?u=<图床外链> —— 站点图标的同源代理 + 边缘缓存。
//
// 为什么要这一层（2026-09-18 实测）：
//   1) 图床里有一批老图标是 `.xicon` / `.vndmicrosofticon` 这种自定义后缀，Cloudflare
//      默认只缓存常见图片后缀，这些返回 `cf-cache-status: DYNAMIC`——每张都要回源到家里的
//      Cloudreve，国内单张 ~2~3s；`.png`/`.svg` 才是 HIT；
//   2) 浏览器对单个域名只开 6 条连接，50 张图标排队串行，冷启动十几秒才铺满，
//      表现就是"标题出来了、图标还是空白"。
// 代理之后：所有图标走已建好的 daohang.ieop.top 一条 HTTP/2 连接并发拉取，Worker 侧再
// 把图片写进 Cloudflare 边缘缓存（caches.default）——之后无论浏览器缓存是否被清，
// 都是边缘直出。
//
// 安全：只允许代理白名单内的图床域名，避免变成开放代理。
const ALLOW_HOSTS = new Set(["img-bed.ieoc.top"]);
const MAX_BYTES = 1024 * 1024;
const EDGE_TTL = 2592000; // 30 天

function bad(status, msg) {
  return new Response(msg, { status, headers: { "cache-control": "no-store" } });
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const raw = url.searchParams.get("u") || "";

  let target;
  try {
    target = new URL(raw);
  } catch {
    return bad(400, "bad url");
  }
  if (target.protocol !== "https:" || !ALLOW_HOSTS.has(target.hostname)) {
    return bad(403, "host not allowed");
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://icon-proxy.internal/${target.href}`, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let up;
  try {
    up = await fetch(target.href, {
      headers: { accept: "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return bad(504, "upstream error: " + (e?.message || "network"));
  }
  if (!up.ok) return bad(502, `upstream ${up.status}`);

  const ct = (up.headers.get("content-type") || "").split(";")[0].trim();
  if (!ct.startsWith("image/")) return bad(502, "not an image: " + ct);

  const body = await up.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BYTES) return bad(502, "bad size");

  const res = new Response(body, {
    headers: {
      "content-type": ct,
      "content-length": String(body.byteLength),
      "cache-control": `public, max-age=${EDGE_TTL}, immutable`,
      "access-control-allow-origin": "*",
    },
  });
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
