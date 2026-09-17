// GET /api/meta?url=<site-url>
// Returns { title, icon } for the "paste a link → auto-fill" flow.
// - 内网地址：服务端无法访问，立即返回 lan:true 让前端走浏览器直连探测。
// - 页面抓取失败（403/超时等）：仍会用公共图标服务兜底，并透传失败原因。
import { fetchHtml, findIcon, isPrivateHost } from "./favicon.js";
import { findBuiltinIconByHost } from "../lib/db.js";

// 图标转存：把抓到的外部图标上传到自建图床，库里只存图床外链。
// 动机：外部图标源不可控——站点 favicon 会 404/防盗链/限流（实测 deepseek 的
// favicon.svg 直接 429），公共图标服务又常被墙。转存后图标国内可达、无第三方依赖。
// 未配置图床或转存失败时，返回 null，调用方继续用原链接。
const ICON_MAX_BYTES = 256 * 1024;

async function rehostIcon(env, iconUrl) {
  const api = String(env?.IMG_UPLOAD_API || "").trim();
  const token = String(env?.IMG_UPLOAD_TOKEN || "").trim();
  if (!api || !iconUrl) return null;
  if (iconUrl.startsWith("data:") || iconUrl.includes("img-bed.ieoc.top")) return null;
  try {
    const res = await fetch(iconUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > ICON_MAX_BYTES) return null;

    // 由 content-type 推扩展名：image/svg+xml → svg；image/x-icon、image/vnd.microsoft.icon → ico；
    // 否则取子类型里的字母数字（避免出现 icon.svgxml / icon.vndmicrosofticon 这种名字）
    const sub = (type.split("/")[1] || "").split(";")[0].split("+")[0].toLowerCase();
    const ext = sub.includes("icon") ? "ico" : (sub.replace(/[^a-z0-9]/g, "") || "png");
    const form = new FormData();
    form.append(String(env.IMG_UPLOAD_FIELD || "").trim() || "file", new Blob([buf], { type }), `icon.${ext}`);

    const headers = { Accept: "application/json, text/plain;q=0.8, */*;q=0.5" };
    if (token) headers.Authorization = "Bearer " + token;
    const up = await fetch(api, { method: "POST", headers, body: form, signal: AbortSignal.timeout(15000) });
    if (!up.ok) return null;
    const text = await up.text();
    const abs = text.match(/https?:\/\/[^\s"'<>\\]+/i);
    if (abs) return abs[0];
    const rel = text.match(/"(\/[^"]+)"/);
    if (rel) { try { return new URL(rel[1], new URL(api).origin).href; } catch { return null; } }
    return null;
  } catch {
    return null;
  }
}

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

  let icon = builtinIcon;
  if (!icon) {
    try {
      icon = await findIcon(normalized, page || { html: "", finalUrl: normalized });
    } catch {}
  }

  // 外部图标一律转存到自建图床（失败则保留原链接，前端仍有首字母兜底）
  let iconSource = builtinIcon ? "builtin" : "external";
  if (icon && !builtinIcon) {
    const hosted = await rehostIcon(env, icon);
    if (hosted) { icon = hosted; iconSource = "rehosted"; }
  }

  const out = { title, icon };
  out.iconSource = iconSource;
  if (pageError) out.error = pageError;
  else if (!title && !icon) out.error = "未能从页面中提取标题或图标";
  const res = json(out);
  // 只在确实拿到图标时缓存（失败结果缓存会掩盖站点恢复）
  if (icon) {
    res.headers.set("Cache-Control", "public, max-age=600");
    context.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return res;
}
