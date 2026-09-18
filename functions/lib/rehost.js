// 把外部图标转存到自建图床，返回图床外链；任何一步失败返回 null（调用方自行回退）。
//
// 为什么要转存：外部图标源不可控——站点 favicon 会 404/防盗链/限流（实测 deepseek 的
// favicon.svg 直接 429），公共图标服务（google s2 / icons.duckduckgo.com）产出的链接
// 在国内直接超时。转存后图标国内可达、无第三方依赖、不依赖目标站点的反爬策略。
//
// 约定：**公共图标服务的链接一律不许交给客户端**，必须先过这里（见 api/favicon.js 的说明）。
const ICON_MAX_BYTES = 256 * 1024;

export async function rehostIcon(env, iconUrl) {
  const api = String(env?.IMG_UPLOAD_API || "").trim();
  const token = String(env?.IMG_UPLOAD_TOKEN || "").trim();
  if (!api || !iconUrl) return null;
  if (iconUrl.startsWith("data:") || iconUrl.includes("img-bed.ieoc.top")) return null;
  // 图床偶发 500/503（今天删了 6,000 多个文件时也见过），下载源图标也可能超时，
  // 重试一次能明显减少「明明有图标却报获取失败」。
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await rehostOnce(env, api, token, iconUrl);
    if (out) return out;
    if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
  }
  return null;
}

async function rehostOnce(env, api, token, iconUrl) {
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
