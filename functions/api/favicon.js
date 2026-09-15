// Shared page-fetching + favicon resolution logic.
// Exported helpers are reused by meta.js (auto title + icon).

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

// Resolve the best icon for a site. `preFetched` = result of fetchHtml() to
// avoid a second request when the caller already downloaded the page.
export async function findIcon(siteUrl, preFetched = null) {
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
    if (hit) return hit;
  }

  let domain = "";
  try { domain = new URL(base).hostname; } catch {}
  const lan = domain && isPrivateHost(domain);

  // 常见路径 + 公共图标服务并发探测（路径优先，服务兜底）。
  // 全部并发把最坏耗时从 6×2s 串行压到 ~2.5s。
  const pathProbes = FALLBACK_PATHS.map((p) => {
    try { return probeImage(new URL(p, base).href); } catch { return Promise.resolve(null); }
  });
  const services = lan ? [] : [
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
    `https://api.iowen.cn/favicon/${domain}.png`, // 对国内站点覆盖更好
    `https://favicon.im/${domain}?larger=true`,
  ].filter(Boolean).map((u) => probeImage(u));

  const results = await Promise.all([...pathProbes, ...services]);
  const pathHit = results.slice(0, pathProbes.length).find(Boolean);
  if (pathHit) return pathHit;
  const serviceHit = results.slice(pathProbes.length).find(Boolean);
  return serviceHit || null;
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
    const icon = await findIcon(normalized);
    if (icon) return json({ found: true, url: icon });
    return json({ found: false, reason: "no icon found" });
  } catch (e) {
    return json({ found: false, reason: e.message });
  }
}
