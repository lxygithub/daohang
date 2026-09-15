// GET  /api/config — 未登录：返回全局配置；已登录：返回该用户自己的配置
//                     （首次登录时从全局配置播种一份副本）
// POST /api/config — 已登录：免密保存到用户自己的配置
//                    未登录：管理密码验证后保存全局配置（原有流程不变）
//
// 响应附带 X-Scope（user|global）与 X-Config-Updated-At 头，前端据此记录同步时间。
import { ensureSchema, getUserData, setUserData, nowISO } from "../lib/db.js";
import { getSessionUser, sessionCookie } from "../lib/auth.js";

// Password resolution order:
//   1. env.ADMIN_PASSWORD_SHA256  (recommended: store sha256 hex of your password)
//   2. env.ADMIN_PASSWORD         (plain text in Cloudflare env vars / wrangler [vars])
//   3. "mewlxy"                   (legacy fallback so existing deployments keep working)
async function verifyPassword(env, input) {
  if (!input) return false;
  if (env.ADMIN_PASSWORD_SHA256) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
    return hex === env.ADMIN_PASSWORD_SHA256;
  }
  return input === (env.ADMIN_PASSWORD || "mewlxy");
}

const DEFAULT_CONFIG = {
  services: [
    { id: "nginx", name: "Nginx", url: "https://nginx.ieoc.top", iconType: "preset", icon: "server" },
    { id: "1panel", name: "1Panel", url: "https://1pannel.ieoc.top", iconType: "preset", icon: "shield" },
    { id: "files", name: "Files", url: "https://files.ieoc.top", iconType: "preset", icon: "folder" },
    { id: "v2ray", name: "V2Ray", url: "https://v2ray.ieoc.top", iconType: "preset", icon: "rocket" },
    { id: "cassos", name: "Cassos", url: "https://cassos.ieoc.top", iconType: "preset", icon: "code" },
    { id: "163", name: "163", url: "https://163.ieoc.top", iconType: "preset", icon: "mail" },
    { id: "jenkins", name: "Jenkins", url: "https://jenkins.ieoc.top", iconType: "preset", icon: "wrench" },
    { id: "emby", name: "Emby", url: "https://emby.ieoc.top", iconType: "preset", icon: "play" },
    { id: "qb", name: "QB", url: "https://qb.ieoc.top", iconType: "preset", icon: "download" },
    { id: "alist", name: "Alist", url: "https://alist.ieoc.top", iconType: "preset", icon: "list" },
    { id: "halo", name: "Halo", url: "https://halo.ieoc.top", iconType: "preset", icon: "globe" },
    { id: "wireguard", name: "WireGuard", url: "http://106.75.241.220:51821/", iconType: "preset", icon: "lock" },
    { id: "gh-proxy", name: "GH-Proxy", url: "https://gh-proxy.ieoc.top/", iconType: "preset", icon: "link" },
  ],
  background: { type: "color", value: "#181818" },
};

const GLOBAL_ID = 1;
const USER_CONFIG_KEY = "config";

export async function onRequest(context) {
  const { request, env } = context;
  const { DB } = env;

  if (request.method === "GET") {
    try {
      await ensureSchema(env);
      const sess = await getSessionUser(env, request);

      // ---- logged in: per-user config (seeded from global on first read) ----
      if (sess) {
        let row = await getUserData(env, sess.user.id, USER_CONFIG_KEY);
        if (!row) {
          const global = await DB.prepare("SELECT config_json FROM nav_config WHERE id = ?")
            .bind(GLOBAL_ID).first();
          const seed = global ? global.config_json : JSON.stringify(DEFAULT_CONFIG);
          await setUserData(env, sess.user.id, USER_CONFIG_KEY, seed, nowISO());
          row = { value: seed, updated_at: nowISO() };
        }
        return new Response(row.value, {
          headers: {
            "Content-Type": "application/json",
            "X-Scope": "user",
            "X-Config-Updated-At": Date.parse(row.updated_at) || Date.now(),
            ...(sess.renewToken ? { "Set-Cookie": sessionCookie(sess.renewToken) } : {}),
          },
        });
      }

      // ---- guest: global config (unchanged) ----
      const result = await DB.prepare("SELECT config_json FROM nav_config WHERE id = ?")
        .bind(GLOBAL_ID).first();
      const body = result ? result.config_json : JSON.stringify(DEFAULT_CONFIG);
      return new Response(body, { headers: { "Content-Type": "application/json", "X-Scope": "global" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (request.method === "POST") {
    try {
      await ensureSchema(env);
      const body = await request.json();

      // Password verification endpoint (guest flow)
      if (body.action === "verify") {
        if (await verifyPassword(env, body.password)) {
          return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: false, error: "密码错误" }), { status: 403, headers: { "Content-Type": "application/json" } });
      }

      const sess = await getSessionUser(env, request);
      const { action, password, ...configData } = body;
      const payload = JSON.stringify(configData);

      // ---- logged in: save the user's own config, no password needed ----
      if (sess) {
        const updatedAt = nowISO();
        await setUserData(env, sess.user.id, USER_CONFIG_KEY, payload, updatedAt);
        return new Response(JSON.stringify({ ok: true, scope: "user", updatedAt }), {
          headers: {
            "Content-Type": "application/json",
            ...(sess.renewToken ? { "Set-Cookie": sessionCookie(sess.renewToken) } : {}),
          },
        });
      }

      // ---- guest: admin-password protected global save ----
      if (!(await verifyPassword(env, password))) {
        return new Response(JSON.stringify({ ok: false, error: "密码错误" }), { status: 403, headers: { "Content-Type": "application/json" } });
      }

      await DB.prepare(
        "INSERT OR REPLACE INTO nav_config (id, config_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
      ).bind(GLOBAL_ID, payload).run();

      return new Response(JSON.stringify({ ok: true, scope: "global" }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
