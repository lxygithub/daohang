const ADMIN_PASSWORD = "mewlxy";

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

export async function onRequest(context) {
  const { request, env } = context;
  const { DB } = env;

  if (request.method === "GET") {
    try {
      const result = await DB.prepare("SELECT config_json FROM nav_config WHERE id = 1").first();
      if (result) {
        return new Response(result.config_json, { headers: { "Content-Type": "application/json" } });
      }
      // Return default config
      return new Response(JSON.stringify(DEFAULT_CONFIG), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  if (request.method === "POST") {
    try {
      const body = await request.json();

      // Password verification endpoint
      if (body.action === "verify") {
        if (body.password === ADMIN_PASSWORD) {
          return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ ok: false, error: "密码错误" }), { status: 403, headers: { "Content-Type": "application/json" } });
      }

      // Save config - require password
      if (body.password !== ADMIN_PASSWORD) {
        return new Response(JSON.stringify({ ok: false, error: "密码错误" }), { status: 403, headers: { "Content-Type": "application/json" } });
      }

      // Strip action/password before saving
      const { action, password, ...configData } = body;

      await DB.prepare(
        "INSERT OR REPLACE INTO nav_config (id, config_json, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP)"
      ).bind(JSON.stringify(configData)).run();

      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
