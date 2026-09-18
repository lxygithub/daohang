// Shared page-fetching + favicon resolution logic.
// Exported helpers are reused by meta.js (auto title + icon).
import { rehostIcon } from "../lib/rehost.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// 识别内网/链路本地地址：服务端（Cloudflare 边缘）无法访问，应改走浏览器直连。
export function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (/\.(local|lan|home|internal|localdomain|arpa)$/.test(h)) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT（Tailscale 等）
  }
  if (h === "::1" || /^(f[cd]|fe80)/.test(h)) return true; // IPv6 环回/ULA/链路本地
  return false;
}

// 把底层 fetch 异常翻译成人话（Node 与 Workers 的报错形态都覆盖）。
function explainFetchError(e) {
  const name = e?.name || "";
  const msg = String(e?.message || "");
  const causeCode = String(e?.cause?.code || "");
  if (name === "TimeoutError" || name === "AbortError") return "连接超时";
  if (/getaddrinfo|ENOTFOUND|EAI_AGAIN|name lookup/i.test(msg + causeCode)) return "无法解析域名";
  if (/ECONNREFUSED|connect.*refused/i.test(msg + causeCode)) return "连接被拒绝";
  if (/ECONNRESET|EPIPE|network/i.test(msg + causeCode)) return "连接被重置";
  if (/CERT|SSL|TLS/i.test(msg + causeCode)) return "证书错误";
  return msg || "连接失败";
}

// 按 Content-Type 头 + 页面 <meta charset> 嗅探编码后解码，修复 GBK 站标题乱码。
async function decodeBody(res) {
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) return "";
  const ct = res.headers.get("Content-Type") || "";
  let charset = (ct.match(/charset=["']?([\w-]+)/i) || [])[1] || "";
  if (!charset) {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 4096));
    charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || "";
  }
  charset = (charset || "utf-8").toLowerCase();
  if (charset === "gb2312" || charset === "gbk") charset = "gb18030"; // 超集，兼容两者
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

export async function fetchHtml(siteUrl, timeout = 8000) {
  let res;
  try {
    res = await fetch(siteUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (e) {
    throw new Error(explainFetchError(e));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (ct && !ct.includes("html") && !ct.includes("xml") && !ct.includes("text")) {
    throw new Error(`非网页内容（${ct.split(";")[0]}）`);
  }
  const html = await decodeBody(res);
  if (!html) throw new Error("页面内容为空");
  // Prefer the final URL after redirects (e.g. http→https)
  return { html, finalUrl: res.url || siteUrl };
}

function parseAttrs(tag) {
  const attrs = {};
  const re = /([:\w][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (c) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'",
    }[c] || c));
}

// 从 HTML 中提取全部图标候选：rel=icon > apple-touch-icon > msapplication-TileImage。
// 支持无引号/单引号/双引号属性（如 <link rel=icon href=/favicon.ico>）。
export function extractIconCandidates(html) {
  const out = { icons: [], apple: [], tiles: [] };
  if (!html) return out;
  let m;
  const linkRe = /<link\b[^>]*>/gi;
  while ((m = linkRe.exec(html)) !== null) {
    const a = parseAttrs(m[0]);
    const rel = (a.rel || "").toLowerCase();
    const href = a.href;
    if (!href) continue;
    if (/(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel)) out.icons.push(href);
    else if (rel.includes("apple-touch-icon")) out.apple.push(href);
  }
  const metaRe = /<meta\b[^>]*>/gi;
  while ((m = metaRe.exec(html)) !== null) {
    const a = parseAttrs(m[0]);
    const key = (a.name || a.property || "").toLowerCase();
    if (key === "msapplication-tileimage" && a.content) out.tiles.push(a.content);
  }
  return out;
}

function isImageResponse(res, url) {
  const ct = (res.headers.get("Content-Type") || "").toLowerCase();
  if (ct.startsWith("image/")) return true;
  // 部分服务器对 .ico 返回空 Content-Type 或 application/octet-stream，按扩展名放行
  const byExt = /\.(ico|png|jpe?g|svg|gif|webp)([?#]|$)/i.test(url);
  return byExt && (ct === "" || ct.includes("octet-stream"));
}

// GET 探测（HEAD 常被 403/405 拒绝）：确认可加载后立即取消 body 省流量。
async function probeImage(url, timeout = 2500) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept": "image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    if (!isImageResponse(res, url)) {
      try { res.body?.cancel(); } catch {}
      return null;
    }
    try { res.body?.cancel(); } catch {}
    return url;
  } catch {
    return null;
  }
}

const FALLBACK_PATHS = [
  "/favicon.ico",
  "/favicon.png",
  "/favicon.svg",
  "/public/favicon.png",
  "/assets/favicon.ico",
  "/assets/favicon.png",
  "/images/favicon.ico",
];

// 公共图标服务：只在「站点自己一点图标都不给」时兜底（整站 403 反爬、SPA 不带 <link rel=icon>）。
// 两者都对不存在的域名返回 404（实测），所以不会把通用地球图当成果命中。
//
// ⚠️ 这两个服务跑在境外，产出的链接在国内浏览器里打不开（2026-09-17 实测均超时）。
// 因此**绝不能把它们的链接交给客户端**：调用方必须先转存到自建图床（见 lib/rehost.js）。
// 2026-09-18 之前这里整个删掉过一次，是因为当年直接把链接存进了配置；现在有转存环节，
// 拿它们当「输入」是安全的——ChatGPT / openai.com 这类整站 403 的站点就靠这一步救回来。
const ICON_SERVICES = [
  { id: "duckduckgo", url: (host) => `https://icons.duckduckgo.com/ip3/${host}.ico` },
  { id: "google-s2", url: (host) => `https://www.google.com/s2/favicons?domain=${host}&sz=128` },
];

// Resolve the best icon for a site. `preFetched` = result of fetchHtml() to
// avoid a second request when the caller already downloaded the page.
// 返回 { url, kind, service? }：kind = "site"（站点自己的图标）| "service"（公共图标服务）；
// 找不到返回 null。opts.services = false 时不查公共服务（给「直接把 URL 交给客户端」的调用方用）。
export async function findIcon(siteUrl, preFetched = null, opts = {}) {
  const useServices = opts.services !== false;
  let base = preFetched?.finalUrl || siteUrl;
  let candidates = [];
  try {
    let html = preFetched?.html;
    if (html == null) {
      const r = await fetchHtml(siteUrl);
      html = r.html;
      base = r.finalUrl || base;
    }
    const c = extractIconCandidates(html);
    candidates = [...c.icons, ...c.apple, ...c.tiles];
  } catch {}

  // 候选链接先验证再采用（<link> 指向 404/防盗链地址的站点很常见，直接采信会存下破图）
  if (candidates.length) {
    const abs = [];
    for (const raw of candidates) {
      try {
        const fullUrl = new URL(decodeEntities(raw), base).href;
        // data:image URI 自包含，直接可用
        if (/^(https?:|data:image\/)/i.test(fullUrl)) abs.push(fullUrl);
      } catch {}
    }
    const checked = await Promise.all(
      abs.map((u) => (/^data:image\//i.test(u) ? Promise.resolve(u) : probeImage(u)))
    );
    const hit = checked.find(Boolean);
    if (hit) return { url: hit, kind: "site" };
  }

  // 常见路径并发探测（最坏耗时从 7×2.5s 串行压到 ~2.5s）。
  const pathProbes = FALLBACK_PATHS.map((p) => {
    try { return probeImage(new URL(p, base).href); } catch { return Promise.resolve(null); }
  });
  const results = await Promise.all(pathProbes);
  const siteHit = results.find(Boolean);
  if (siteHit) return { url: siteHit, kind: "site" };

  // 站点自己给不出 → 公共图标服务兜底（结果必须由调用方转存，见文件头的说明）
  if (!useServices) return null;
  let host = "";
  try { host = new URL(base).hostname; } catch { return null; }
  if (!host) return null;
  const serviceHits = await Promise.all(
    ICON_SERVICES.map(async (s) => ((await probeImage(s.url(host), 8000)) ? { ...s, hit: true } : null))
  );
  const svc = serviceHits.find(Boolean);
  if (!svc) return null;
  return { url: svc.url(host), kind: "service", service: svc.id };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const siteUrl = url.searchParams.get("url");
  const headers = { "Content-Type": "application/json" };
  const json = (obj) => new Response(JSON.stringify(obj), { headers });

  if (!siteUrl) return json({ found: false });

  let normalized;
  try {
    normalized = new URL(siteUrl.includes("://") ? siteUrl : "https://" + siteUrl).href;
  } catch {
    return json({ found: false, reason: "链接无效" });
  }

  if (isPrivateHost(new URL(normalized).hostname) && !env?.ALLOW_PRIVATE_FETCH) {
    return json({ found: false, lan: true, reason: "内网地址无法从服务端访问" });
  }

  try {
    const found = await findIcon(normalized);
    if (!found) return json({ found: false, reason: "no icon found" });
    // 公共图标服务的链接国内打不开，必须转存成图床外链再返回；转存失败就当作没找到
    if (found.kind === "service") {
      const hosted = await rehostIcon(env, found.url);
      if (!hosted) return json({ found: false, reason: `站点不给图标，公共图标服务（${found.service}）转存失败` });
      return json({ found: true, url: hosted, source: found.service });
    }
    return json({ found: true, url: found.url, source: "site" });
  } catch (e) {
    return json({ found: false, reason: e.message });
  }
}
