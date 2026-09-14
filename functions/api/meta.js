// GET /api/meta?url=<site-url>
// Returns { title, icon } for the "paste a link → auto-fill" flow.
import { fetchHtml, findIcon } from "./favicon.js";

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
  const { request } = context;
  const url = new URL(request.url);
  const siteUrl = url.searchParams.get("url");

  if (!siteUrl || !/^https?:\/\//i.test(siteUrl.includes("://") ? siteUrl : "https://" + siteUrl)) {
    return new Response(JSON.stringify({ title: "", icon: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const normalized = siteUrl.includes("://") ? siteUrl : "https://" + siteUrl;

  try {
    const page = await fetchHtml(normalized);
    const title = extractTitle(page?.html);
    let icon = null;
    try {
      icon = await findIcon(normalized, page);
    } catch {}
    return new Response(JSON.stringify({ title, icon }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ title: "", icon: null, error: e.message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
