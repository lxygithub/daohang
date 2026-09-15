// GET /api/meta?url=<site-url>
// Returns { title, icon } for the "paste a link → auto-fill" flow.
// - 内网地址：服务端无法访问，立即返回 lan:true 让前端走浏览器直连探测。
// - 页面抓取失败（403/超时等）：仍会用公共图标服务兜底，并透传失败原因。
import { fetchHtml, findIcon, isPrivateHost } from "./favicon.js";

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
  let icon = null;
  try {
    // 页面抓取失败时传空 html，避免 findIcon 二次抓取整页，直接走路径+服务探测
    icon = await findIcon(normalized, page || { html: "", finalUrl: normalized });
  } catch {}

  const out = { title, icon };
  if (pageError) out.error = pageError;
  else if (!title && !icon) out.error = "未能从页面中提取标题或图标";
  return json(out);
}
