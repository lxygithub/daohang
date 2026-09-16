// GET / POST /api/config — account-only configuration storage.
// An expired or missing session never falls back to shared guest data.
import { ensureSchema, getUserData, setUserData, nowISO } from "../lib/db.js";
import { getSessionUser, sessionCookie, json, sameOrigin } from "../lib/auth.js";

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

const USER_CONFIG_KEY = "config";

export async function onRequest(context) {
  const { request, env } = context;
  try {
    await ensureSchema(env);
    const sess = await getSessionUser(env, request);
    if (!sess) return json({ error: "登录已过期，请重新登录" }, { status: 401 });

    if (request.method === "GET") {
      let row = await getUserData(env, sess.user.id, USER_CONFIG_KEY);
      if (!row) {
        const now = nowISO();
        const seed = JSON.stringify(DEFAULT_CONFIG);
        await setUserData(env, sess.user.id, USER_CONFIG_KEY, seed, now);
        row = { value: seed, updated_at: now };
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

    if (request.method === "POST") {
      if (!sameOrigin(request)) return json({ error: "非法来源" }, { status: 403 });
      const configData = await request.json();
      const updatedAt = nowISO();
      await setUserData(env, sess.user.id, USER_CONFIG_KEY, JSON.stringify(configData), updatedAt);
      return json({ ok: true, scope: "user", updatedAt }, {
        headers: sess.renewToken ? { "Set-Cookie": sessionCookie(sess.renewToken) } : {},
      });
    }

    return json({ error: "Method Not Allowed" }, { status: 405 });
  } catch (e) {
    return json({ error: e.message || "配置请求失败" }, { status: 500 });
  }
}
