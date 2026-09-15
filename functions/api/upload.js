// 自建图床上传代理：把用户上传的图片转发到外部图床（如基于 Telegram Bot 的
// 开源图床），换取外链 URL 存进配置 —— 避免 base64 内联导致 D1 配置行与同步
// 载荷膨胀。浏览器不直连图床：绕开 CORS、图床鉴权信息不出服务端。
//
// 环境变量（均可选；未配置 IMG_UPLOAD_API 时接口返回 501，前端自动回退 base64 内联）：
//   IMG_UPLOAD_API    图床上传接口完整 URL（POST multipart/form-data）— wrangler.toml [vars]
//   IMG_UPLOAD_FIELD  multipart 文件字段名，默认 'file'                    — [vars]
//   IMG_UPLOAD_TOKEN  鉴权 token，以 `Authorization: Bearer <token>` 发送  — 仪表板加密机密
//   IMG_UPLOAD_QUERY  鉴权查询串，原样拼到 URL 后（如 'token=xxx'）        — 仪表板加密机密
//
// 响应解析容错：递归在 JSON 中找首个 http(s) URL（优先 url/link/src/path 等键），
// 支持纯文本响应，支持相对路径（以图床 origin 补全）——兼容绝大多数开源自建图床。
import { getSessionUser } from "../lib/auth.js";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// 递归找第一个像图片外链的字符串（http(s) 绝对路径或 / 开头相对路径）
function findUrl(v, depth = 0) {
  if (v == null || depth > 6) return null;
  if (typeof v === "string") {
    if (/^https?:\/\/\S+$/i.test(v)) return v;
    // 相对路径（如 CloudFlare-ImgBed 默认返回 /file/xxx.jpg）→ 由调用方补图床 origin
    if (/^\/[^\s"'<>\\]+$/.test(v)) return v;
    return null;
  }
  if (Array.isArray(v)) {
    for (const it of v) { const r = findUrl(it, depth + 1); if (r) return r; }
    return null;
  }
  if (typeof v === "object") {
    const preferred = ["url", "link", "src", "path", "img", "image", "file"];
    for (const k of preferred) {
      if (k in v) { const r = findUrl(v[k], depth + 1); if (r) return r; }
    }
    for (const k of Object.keys(v)) {
      if (preferred.includes(k)) continue;
      const r = findUrl(v[k], depth + 1); if (r) return r;
    }
  }
  return null;
}

async function extractUrl(res, apiBase) {
  const origin = new URL(apiBase).origin;
  const absolute = (u) => {
    if (!u) return null;
    try { return new URL(u, origin).href; } catch { return null; }
  };
  try {
    const direct = absolute(findUrl(await res.json()));
    if (direct) return direct;
  } catch { /* 非 JSON，走文本 */ }
  const text = await res.text().catch(() => "");
  const m = text.match(/https?:\/\/[^\s"'<>\\]+/i);
  if (m) return m[0];
  const rel = text.trim().match(/^(\/[^\s"'<>\\]+)$/); // 整个响应就是个相对路径
  if (rel) return absolute(rel[1]);
  return null;
}

export async function onRequest(context) {
  const { request, env } = context;

  // GET：前端探测图床是否配置（决定上传按钮走图床还是内联 base64）
  if (request.method === "GET") {
    return json({ enabled: Boolean(String(env.IMG_UPLOAD_API || "").trim()) });
  }

  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

  // 上传必须登录，防匿名滥用
  const sess = await getSessionUser(env, request);
  if (!sess) return json({ error: "请先登录" }, 401);

  const api = String(env.IMG_UPLOAD_API || "").trim();
  if (!api) return json({ error: "图床未配置（IMG_UPLOAD_API）" }, 501);

  let form;
  try { form = await request.formData(); } catch { return json({ error: "无效的表单数据" }, 400); }
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "缺少文件字段 file" }, 400);
  if (!file.type || !file.type.startsWith("image/")) return json({ error: "仅支持图片文件" }, 415);
  if (file.size > MAX_BYTES) return json({ error: "图片超过 8MB 限制" }, 413);

  const field = String(env.IMG_UPLOAD_FIELD || "").trim() || "file";
  const out = new FormData();
  out.append(field, file, file.name || "image.png");

  const q = String(env.IMG_UPLOAD_QUERY || "").trim();
  // 目录透传：客户端可带 ?uploadFolder=xxx（cfbed 支持指定上传目录，相对路径如 icons/daohang）。
  // 净化：仅允许字母数字 _ - /，禁止 .. 防目录穿越，限长 96，段首尾去斜杠。
  let folder = "";
  try {
    const raw = new URL(request.url).searchParams.get("uploadFolder") || "";
    folder = raw.trim().replace(/^\/+|\/+$/g, "");
    if (folder && (!/^[\w\-/]+$/.test(folder) || folder.includes("..") || folder.length > 96)) {
      return json({ error: "uploadFolder 仅支持字母数字、-、_、/，且不能包含 .." }, 400);
    }
  } catch { /* URL 解析失败则忽略目录参数 */ }
  const qs = [q.replace(/^\?+/, ""), folder ? "uploadFolder=" + encodeURIComponent(folder) : ""]
    .filter(Boolean).join("&");
  const target = qs ? api + (api.includes("?") ? "&" : "?") + qs : api;
  const headers = { Accept: "application/json, text/plain;q=0.8, */*;q=0.5" };
  const tk = String(env.IMG_UPLOAD_TOKEN || "").trim();
  if (tk) headers.Authorization = "Bearer " + tk;

  let res;
  try {
    res = await fetch(target, { method: "POST", headers, body: out, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return json({ error: "图床连接失败：" + (e.message || "network") }, 502);
  }
  if (!res.ok) return json({ error: `图床返回 ${res.status}` }, 502);

  const url = await extractUrl(res, api);
  if (!url) return json({ error: "无法从图床响应解析出图片 URL" }, 502);
  return json({ ok: true, url });
}
