// GET /api/wallpaper — random Bing daily wallpaper.
// Fetches several windows of the Bing HPImageArchive (server-side, no CORS
// issues), merges & dedupes the pool, returns one random 1920x1080 image.
// Image URLs are rewritten to cn.bing.com so they load fast in mainland China.

const WINDOWS = [0, 7, 14, 21]; // idx offsets → ~32 distinct images
const SIZE = "_1920x1080.jpg";

async function fetchWindow(idx) {
  const endpoints = [
    `https://cn.bing.com/HPImageArchive.aspx?format=js&idx=${idx}&n=8`,
    `https://www.bing.com/HPImageArchive.aspx?format=js&idx=${idx}&n=8`,
  ];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Referer": "https://cn.bing.com/",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data?.images) && data.images.length) return data.images;
    } catch {}
  }
  return [];
}

export async function onRequest(context) {
  const { request } = context;

  const batches = await Promise.allSettled(WINDOWS.map((idx) => fetchWindow(idx)));

  const pool = new Map();
  for (const b of batches) {
    if (b.status !== "fulfilled") continue;
    for (const img of b.value) {
      if (!img?.urlbase) continue;
      const id = img.urlbase;
      if (!pool.has(id)) {
        pool.set(id, {
          url: `https://cn.bing.com${id}${SIZE}`,
          copyright: img.copyright || "",
        });
      }
    }
  }

  const list = [...pool.values()];
  if (!list.length) {
    return new Response(JSON.stringify({ error: "failed to fetch bing wallpapers" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const pick = list[Math.floor(Math.random() * list.length)];

  return new Response(JSON.stringify(pick), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
