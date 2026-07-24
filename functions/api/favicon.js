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
    const iconMatch = html.match(
      /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["'][^>]*>/i
    );
    if (!iconMatch) {
      return fallback(siteUrl, "no link tag");
    }

    const iconPath = iconMatch[1];
    const fullUrl = new URL(iconPath, siteUrl).href;

    return new Response(JSON.stringify({ found: true, url: fullUrl }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return fallback(siteUrl, e.message);
  }
}

async function fallback(siteUrl, reason) {
  // Try /favicon.ico as last resort
  const fallbackUrl = new URL("/favicon.ico", siteUrl).href;
  try {
    const res = await fetch(fallbackUrl, { method: "HEAD", signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      return new Response(JSON.stringify({ found: true, url: fallbackUrl }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {}

  return new Response(JSON.stringify({ found: false, reason }), {
    headers: { "Content-Type": "application/json" },
  });
}
