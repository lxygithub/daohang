// Shared page-fetching + favicon resolution logic.
// Exported helpers are reused by meta.js (auto title + icon).

export async function fetchHtml(siteUrl, timeout = 8000) {
  const res = await fetch(siteUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) return null;
  const ct = res.headers.get("Content-Type") || "";
  if (ct && !ct.includes("html") && !ct.includes("xml") && !ct.includes("text")) return null;
  const html = await res.text();
  if (!html) return null;
  // Prefer the final URL after redirects (e.g. http→https)
  return { html, finalUrl: res.url || siteUrl };
}

function isImageResponse(res) {
  const ct = res.headers.get("Content-Type") || "";
  return ct.startsWith("image/");
}

const FALLBACK_PATHS = [
  "/favicon.ico",
  "/favicon.png",
  "/public/favicon.png",
  "/assets/favicon.ico",
  "/assets/favicon.png",
  "/images/favicon.ico",
];

// Resolve the best icon for a site. `preFetched` = result of fetchHtml() to
// avoid a second request when the caller already downloaded the page.
export async function findIcon(siteUrl, preFetched = null) {
  let iconPath = null;
  try {
    let html = preFetched?.html;
    if (html === undefined || html === null) {
      const r = await fetchHtml(siteUrl);
      html = r?.html ?? "";
    }
    if (html) {
      // <link rel="icon" | shortcut icon | apple-touch-icon" href="...">
      // Require whitespace before href= to avoid matching ng-href
      const candidates = [];
      const linkRe = /<link[^>]*>/gi;
      let m;
      while ((m = linkRe.exec(html)) !== null) {
        const tag = m[0];
        const relM = tag.match(/\srel=["']([^"']+)["']/i);
        const hrefM = tag.match(/\shref=["']([^"']+)["']/i);
        if (!relM || !hrefM) continue;
        const rel = relM[1].toLowerCase();
        if (/(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel)) candidates.unshift(hrefM[1]);
        else if (rel.includes("apple-touch-icon")) candidates.push(hrefM[1]);
      }
      iconPath = candidates[0] || null;
    }
  } catch {}

  if (iconPath) {
    try {
      const fullUrl = new URL(iconPath, preFetched?.finalUrl || siteUrl).href;
      if (/^https?:/i.test(fullUrl)) return fullUrl;
    } catch {}
  }

  // Common fallback paths
  for (const path of FALLBACK_PATHS) {
    const tryUrl = new URL(path, siteUrl).href;
    try {
      const res = await fetch(tryUrl, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (res.ok && isImageResponse(res)) return tryUrl;
    } catch {}
  }

  const domain = new URL(siteUrl).hostname;

  // DuckDuckGo favicon service (reachable from Cloudflare edge)
  const ddgUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  try {
    const res = await fetch(ddgUrl, { method: "HEAD", signal: AbortSignal.timeout(2000) });
    if (res.ok && isImageResponse(res)) return ddgUrl;
  } catch {}

  // Google favicon service
  const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  try {
    const res = await fetch(googleUrl, { method: "HEAD", signal: AbortSignal.timeout(2000) });
    if (res.ok && isImageResponse(res)) return googleUrl;
  } catch {}

  return null;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const siteUrl = url.searchParams.get("url");

  if (!siteUrl) {
    return new Response(JSON.stringify({ found: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const icon = await findIcon(siteUrl);
    if (icon) {
      return new Response(JSON.stringify({ found: true, url: icon }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ found: false, reason: "no icon found" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ found: false, reason: e.message }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}
