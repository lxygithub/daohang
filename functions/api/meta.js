// GET /api/meta?url=<site-url>
// Returns { title, icon } for the "paste a link → auto-fill" flow.
// - 内网地址：服务端无法访问，立即返回 lan:true 让前端走浏览器直连探测。
// - 页面抓取失败（403/超时等）：仍会用公共图标服务兜底，并透传失败原因。
import { fetchHtml, findIcon, isPrivateHost } from "./favicon.js";
import { findBuiltinIconByHost } from "../lib/db.js";
import { rehostIcon } from "../lib/rehost.js";

const ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};

function decodeEntities(s) {
  return s
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] || m)
    .replace(/&#(\d+);/g, (m, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return m; }
    });
}

function extractTitle(html) {
  if (!html) return "";
  // og:title / twitter:title first, then <title>
  const og =
    html.match(/<meta[^>]+property=["'](?:og:title|twitter:title)["'][^>]*\scontent=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+\scontent=["']([^"']+)["'][^>]*property=["'](?:og:title|twitter:title)["']/i);
  let t = og ? og[1] : "";
  if (!t) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) t = m[1];
  }
  if (!t) return "";
  return decodeEntities(t.replace(/\s+/g, " ").trim()).slice(0, 60);
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const siteUrl = url.searchParams.get("url");
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const json = (obj) => new Response(JSON.stringify(obj), { headers });

  if (!siteUrl) return json({ title: "", icon: null });

  let normalized;
  try {
    normalized = new URL(siteUrl.includes("://") ? siteUrl : "https://" + siteUrl).href;
  } catch {
    return json({ title: "", icon: null, error: "链接无效" });
  }

  // 结果缓存 10 分钟：编辑弹窗里改一次链接可能触发多次抓取，而不论命中内置库还是
  // 转存图床，每次都要经过网关往返（≈2.5s）；更要紧的是**重复请求会重复上传图床**。
  const cache = caches.default;
  const cacheKey = new Request(`https://meta-cache.internal/?u=${encodeURIComponent(normalized)}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (isPrivateHost(new URL(normalized).hostname) && !env?.ALLOW_PRIVATE_FETCH) {
    return json({ title: "", icon: null, lan: true, reason: "内网地址需由浏览器直连获取" });
  }

  let page = null;
  let pageError = "";
  try {
    page = await fetchHtml(normalized);
  } catch (e) {
    pageError = e?.message || "页面获取失败";
  }

  const title = page ? extractTitle(page.html) : "";
  // 图标优先取内置站点库（自家图床外链）：国内可达、无第三方依赖、无混合内容，
  // 命中时省掉整轮 favicon 探测；未命中再走「站点自身 favicon」的老逻辑。
  let builtinIcon = null;
  try {
    builtinIcon = await findBuiltinIconByHost(env, new URL(normalized).hostname);
  } catch {}

  let found = null;
  if (!builtinIcon) {
    try {
      found = await findIcon(normalized, page || { html: "", finalUrl: normalized });
    } catch {}
  }

  let icon = builtinIcon || found?.url || null;
  // 外部图标一律转存到自建图床（失败则保留原链接，前端仍有首字母兜底）
  let iconSource = builtinIcon ? "builtin" : "external";
  if (icon && !builtinIcon) {
    const hosted = await rehostIcon(env, icon);
    if (hosted) { icon = hosted; iconSource = "rehosted"; }
    // 公共图标服务（google s2 / duckduckgo）的链接国内打不开，转存失败时宁可不给图标，
    // 让前端走首字母兜底，也不能把坏链接存进配置。
    else if (found?.kind === "service") { icon = null; iconSource = "external"; }
  }

  const out = { title, icon };
  out.iconSource = iconSource;
  // 站点整站 403 反爬时，图标是靠公共图标服务救回来的——把来源带出去便于排查
  if (found?.kind === "service" && icon) out.iconService = found.service;
  // 抓取失败的原因会原样透给前端提示，重定向链那种能到几 KB，截断一下
  if (pageError) out.error = pageError.slice(0, 120);
  else if (!title && !icon) out.error = "未能从页面中提取标题或图标";
  const res = json(out);
  // 只在确实拿到图标时缓存（失败结果缓存会掩盖站点恢复）
  if (icon) {
    res.headers.set("Cache-Control", "public, max-age=600");
    context.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return res;
}
