// POST /api/ai/group —— 把一批站点交给大模型（OpenAI 兼容接口）分组。
//
// 为什么经 Worker 转发：国内浏览器直连 api.deepseek.com / api.openai.com 常超时或被 CORS 拦，
// 而 Worker 在境外边缘，通道稳定；API Key 仍然只存在用户浏览器里（每次随请求带上来），
// 服务端不落库、不记日志。
//
// 请求体：{ apiBase, model, apiKey, groups: string[], items: [{id,name,url}] }
// 响应  ：{ ok: true, groups: { [siteId]: 分组名 }, model, usage }
//
// 安全：必须登录；apiBase 必须是 https 公网地址（挡掉内网/本机，避免被当成 SSRF 跳板）。
import { getSessionUser, json } from "../../lib/auth.js";
import { isPrivateHost } from "../favicon.js";
import { getUserData } from "../../lib/db.js";

const MAX_ITEMS = 80;
const MAX_GROUP_NAME = 12;

const SYSTEM_PROMPT =
  "你是一个导航站分类助手。用户会给你一批站点（名字 + 网址）和已有的分组名，" +
  "请为每个站点挑选最合适的分组。规则：" +
  "1) 优先复用已有分组；确实不合适时才新建，新分组名用 2~4 个汉字，风格与已有分组一致；" +
  "2) 分组要粗粒度、便于一眼扫到（如「开发」「AI」「影音」「购物」「社交」「资讯」「工具」「学习」），不要为单个站点建组；" +
  "3) 只输出 JSON，形如 {\"<站点id>\": \"分组名\"}，不要输出任何解释、不要用代码块包裹。";

function sanitizeGroupName(v) {
  const s = String(v || "").replace(/\s+/g, "").slice(0, MAX_GROUP_NAME);
  return /^[\u4e00-\u9fa5A-Za-z0-9+#./-]+$/.test(s) ? s : "";
}

function buildPrompt(items, groups) {
  const lines = items.map((it) => `${it.id}\t${it.name || ""}\t${it.url || ""}`);
  return [
    groups.length ? `已有分组：${groups.join("、")}` : "暂无已有分组，请自行归纳分组。",
    "",
    "待分类站点（格式：id\\t名称\\t网址）：",
    ...lines,
    "",
    "请输出 JSON 对象：key 为站点 id，value 为分组名。",
  ].join("\n");
}

/** 从模型回复里薅出 JSON（容忍 ```json 代码块与前后废话） */
function parseJsonOut(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(body.slice(start, end + 1));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, { status: 405 });

  const sess = await getSessionUser(env, request).catch(() => null);
  if (!sess) return json({ ok: false, error: "请先登录" }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "请求体不是 JSON" }, { status: 400 }); }

  // Key 只写不读：浏览器手里没有，默认从库里取（ai_key）。apiBase/model 同理兜底，
  // 这样即便前端只发 items 也能工作。
  let apiKey = String(body.apiKey || "").trim();
  let model = String(body.model || "").trim();
  let apiBase = String(body.apiBase || "").trim().replace(/\/+$/, "");
  if (!apiKey || !model || !apiBase) {
    const [secretRow, prefRow] = await Promise.all([
      getUserData(env, sess.user.id, "ai_key").catch(() => null),
      getUserData(env, sess.user.id, "ai").catch(() => null),
    ]);
    if (!apiKey) apiKey = String(secretRow?.value || "").trim();
    if (prefRow?.value) {
      try {
        const o = JSON.parse(prefRow.value) || {};
        if (!model) model = String(o.model || "").trim();
        if (!apiBase) apiBase = String(o.apiBase || "").trim().replace(/\/+$/, "");
      } catch {}
    }
  }
  const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const groups = Array.isArray(body.groups) ? body.groups.map((g) => String(g).slice(0, MAX_GROUP_NAME)).filter(Boolean) : [];

  if (!apiKey) return json({ ok: false, error: "还没保存大模型 API Key，请到「设置 → AI 自动分组」里填一次" }, { status: 400 });
  if (!model || !apiBase) return json({ ok: false, error: "请先填好接口地址与模型名" }, { status: 400 });
  if (!items.length) return json({ ok: true, groups: {} });

  let url;
  try { url = new URL(apiBase); } catch { return json({ ok: false, error: "接口地址不合法" }, { status: 400 }); }
  if (url.protocol !== "https:") return json({ ok: false, error: "接口地址必须是 https" }, { status: 400 });
  if (isPrivateHost(url.hostname)) return json({ ok: false, error: "接口地址不能是内网地址" }, { status: 400 });

  const endpoint = /\/chat\/completions$/.test(url.pathname) ? url.href : url.href.replace(/\/+$/, "") + "/chat/completions";

  let upstream;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildPrompt(items, groups) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    return json({ ok: false, error: `连不上大模型接口：${e?.message || "network"}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return json({ ok: false, error: `大模型接口返回 ${upstream.status}：${detail.slice(0, 180)}` }, { status: 502 });
  }

  const data = await upstream.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;
  const parsed = parseJsonOut(content);
  if (!parsed) {
    return json({ ok: false, error: `模型没按 JSON 返回：${String(content || "").slice(0, 160)}` }, { status: 502 });
  }

  // 只认我们发过去的 id，分组名做一次净化
  const known = new Set(items.map((it) => String(it.id)));
  const out = {};
  for (const [id, g] of Object.entries(parsed)) {
    if (!known.has(String(id))) continue;
    const name = sanitizeGroupName(g);
    if (name) out[String(id)] = name;
  }
  return json({ ok: true, groups: out, model, usage: data?.usage || null });
}
