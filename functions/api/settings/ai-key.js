// POST /api/settings/ai-key  { apiKey } —— 只写不读地保存大模型 API Key。
//
// 设计（2026-09-18）：
//   * Key 单独存在 user_data.key = 'ai_key'，**永远不会通过任何接口回传给浏览器**
//     （/api/user/prefs 读 'ai' 时会剥掉 apiKey，只给 hasKey 标记；'ai_key' 是保留键）；
//   * 浏览器 localStorage 里也不再保存 Key —— 控制台里看不到了；
//   * 调用大模型时（/api/ai/group）请求里不带 Key，由 Worker 用当前会话的用户 id 去库里取。
// 空字符串 = 清除已保存的 Key。
import { ensureSchema, setUserData } from "../../lib/db.js";
import { getSessionUser, json, sameOrigin } from "../../lib/auth.js";

const MAX_KEY_LEN = 512;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== "POST") return json({ error: "Method Not Allowed" }, { status: 405 });
  try {
    await ensureSchema(env);
    const sess = await getSessionUser(env, request);
    if (!sess) return json({ error: "未登录" }, { status: 401 });
    if (!sameOrigin(request)) return json({ error: "非法来源" }, { status: 403 });

    const body = await request.json().catch(() => ({}));
    const apiKey = String(body.apiKey ?? "").trim();
    if (apiKey.length > MAX_KEY_LEN) return json({ error: "API Key 过长" }, { status: 400 });

    await setUserData(env, sess.user.id, "ai_key", apiKey, new Date().toISOString());
    return json({ ok: true, hasKey: Boolean(apiKey) });
  } catch (e) {
    return json({ error: e.message || "保存失败" }, { status: 500 });
  }
}
