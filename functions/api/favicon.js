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
    // Fetch the page HTML
    const res = await fetch(siteUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Daohang/1.0)" },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return fallback(siteUrl, "HTTP " + res.status);
    }

    const html = await res.text();

    // Match <link rel="icon" href="..."> or <link rel="shortcut icon" href="...">
    // Require whitespace before href= to avoid matching ng-href
    const iconMatch = html.match(
      /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*\shref=["']([^"']+)["'][^>]*>/i
    );
    // Also try apple-touch-icon if no standard icon found
    const appleMatch = !iconMatch ? html.match(
      /<link[^>]*rel=["']apple-touch-icon(?:-precomposed)?["'][^>]*\shref=["']([^"']+)["'][^>]*>/i
    ) : null;
    const iconPath = iconMatch ? iconMatch[1] : (appleMatch ? appleMatch[1] : null);
    if (!iconPath) {
      return fallback(siteUrl, "no link tag");
    }
    const fullUrl = new URL(iconPath, siteUrl).href;

    return new Response(JSON.stringify({ found: true, url: fullUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return fallback(siteUrl, e.message);
  }
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

async function fallback(siteUrl, reason) {
  for (const path of FALLBACK_PATHS) {
    const tryUrl = new URL(path, siteUrl).href;
    try {
      const res = await fetch(tryUrl, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (res.ok && isImageResponse(res)) {
        return new Response(JSON.stringify({ found: true, url: tryUrl }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    } catch {}
  }

  // Google favicon service
  const domain = new URL(siteUrl).hostname;
  const googleUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  try {
    const res = await fetch(googleUrl, { signal: AbortSignal.timeout(2000) });
    if (res.ok && isImageResponse(res)) {
      return new Response(JSON.stringify({ found: true, url: googleUrl }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {}

  // DuckDuckGo favicon service
  const ddgUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
  try {
    const res = await fetch(ddgUrl, { method: "HEAD", signal: AbortSignal.timeout(2000) });
    if (res.ok && isImageResponse(res)) {
      return new Response(JSON.stringify({ found: true, url: ddgUrl }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {}

  return new Response(JSON.stringify({ found: false, reason }), {
    headers: { "Content-Type": "application/json" },
  });
}
