// GET /api/site-suggest?q=<关键词> —— 新增/编辑站点时的「模糊搜索」。
//
// 一个关键词给两类候选：
//   1) library：自家内置站点库（1.9 万条，自带图床图标）里 LIKE 命中的站点，按热度排序；
//   2) domains：关键词不像域名时，用公共 DoH 猜「<关键词>.<常见后缀>」哪些真实存在，
//      选中后由前端再走 /api/meta 取标题和图标。
//
// 为什么用 DoH 猜域名：能"关键词 → 站点"的公共服务基本都要账号或 key——
//   * Domainr v2：无 client_id 直接 401（实测）；
//   * Google/Bing 联想：返回的是**搜索词**（"chatgpt login"）而不是域名，用不上；
//   * Wikidata wbsearchentities：能查实体，但要再查一次 P856 官方站点，中文小站覆盖还差。
// 公共 DoH（cloudflare-dns.com / dns.google）免 key、稳定，且 Cloudflare 的 Worker 天然能访问，
// 拿来验证候选域名是否真实存在最划算。中文关键词 DNS 猜不出来，交给站点库那一侧。
import { ensureSchema, listBuiltinSites } from "../lib/db.js";
import { json } from "../lib/auth.js";

// 顺序即优先级（返回时按这个顺序排）
const TLDS = ["com", "cn", "net", "org", "io", "co", "so", "com.cn", "app", "dev", "ai", "me", "cc", "tv", "top", "xyz"];
const DOH = "https://cloudflare-dns.com/dns-query";
const MAX_LIBRARY = 8;
const MAX_DOMAINS = 6;
// 从库里多取一些再做「同一站点只留一条 + 路径浅的优先」的重排，否则搜索 notion 会
// 连续给出 4 条别人分享的 notion.so/xxx 子页面。
const LIBRARY_SCAN = 24;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return String(u) } };
const pathDepth = (u) => { try { return new URL(u).pathname.split("/").filter(Boolean).length } catch { return 9 } };

// 爬来的 name 偶尔是坏的（把 `</title><meta ...` 也抓进来了）：太长的或带标签的用域名代替
function cleanName(name, url) {
  const s = String(name || "").replace(/\s+/g, " ").trim();
  if (!s || s.length > 40 || /[<>"'`]|<\/?[a-z]/i.test(s)) return hostOf(url);
  return s;
}

function rankLibrary(items) {
  const byHost = new Map();
  for (const it of items) {
    const h = hostOf(it.url);
    if (!byHost.has(h)) byHost.set(h, it);
  }
  return [...byHost.values()]
    .sort((a, b) => pathDepth(a.url) - pathDepth(b.url) || String(a.name).length - String(b.name).length)
    .slice(0, MAX_LIBRARY);
}

const normalizeKeyword = (raw) => String(raw || "").trim().toLowerCase().slice(0, 40);

// 取关键词里能当域名标签的部分：只接受 ASCII 字母数字和连字符，其余（中文等）返回空
function asciiLabel(kw) {
  const s = kw.replace(/\s+/g, "").replace(/^www\./, "");
  return /^[a-z0-9][a-z0-9-]{0,38}$/.test(s) ? s : "";
}

// 用公共 DoH 判断域名是否存在：Status=0 且有 Answer（NXDOMAIN 是 Status=3）
async function resolves(name) {
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=A`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const d = await res.json();
    return Number(d.Status) === 0 && Array.isArray(d.Answer) && d.Answer.length > 0;
  } catch {
    return false;
  }
}

async function guessDomains(kw) {
  const raw = kw.replace(/\s+/g, "");
  // 关键词本身就是域名（taobao.com）→ 只验证它自己
  const isDomainish = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(raw);
  const label = isDomainish ? "" : asciiLabel(raw);
  const candidates = isDomainish ? [raw] : label ? TLDS.map((t) => `${label}.${t}`) : [];
  if (!candidates.length) return [];
  const checked = await Promise.all(candidates.map(async (d) => ((await resolves(d)) ? d : null)));
  return checked.filter(Boolean).slice(0, MAX_DOMAINS);
}

export async function onRequest(context) {
  const { request, env } = context;
  await ensureSchema(env);

  if (request.method !== "GET") return json({ error: "Method Not Allowed" }, { status: 405 });

  const url = new URL(request.url);
  const q = normalizeKeyword(url.searchParams.get("q"));
  if (!q) return json({ ok: true, q: "", library: [], domains: [], libraryTotal: 0 });

  // 同一关键词 10 分钟内直接命中边缘缓存（站点库那趟网关往返约 2.5s）
  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/api/site-suggest?q=${encodeURIComponent(q)}`, { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // 两件事互不依赖，并行；站点库失败不影响域名猜测
  const [lib, domains] = await Promise.all([
    listBuiltinSites(env, { qstr: q, page: 1, pageSize: LIBRARY_SCAN }).catch(() => null),
    guessDomains(q),
  ]);

  const res = json({
    ok: true,
    q,
    library: rankLibrary(lib?.items || []).map((s) => ({
      id: s.id, name: cleanName(s.name, s.url), url: s.url, icon: s.icon || "",
      description: s.description || "", cats: s.cats || [],
    })),
    libraryTotal: lib?.total || 0,
    domains,
  });
  res.headers.set("Cache-Control", "public, max-age=300, s-maxage=600");
  context.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
