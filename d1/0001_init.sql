-- 创建导航配置表
CREATE TABLE IF NOT EXISTS nav_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- 单行配置
  config_json TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 创建访问令牌表（用于密码验证）
CREATE TABLE IF NOT EXISTS access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);

-- 初始化默认配置
INSERT OR IGNORE INTO nav_config (id, config_json) VALUES (1, '{"services":[{"id":"nginx","name":"Nginx","url":"https://nginx.ieoc.top","iconType":"preset","icon":"server"},{"id":"1panel","name":"1Panel","url":"https://1pannel.ieoc.top","iconType":"preset","icon":"shield"},{"id":"files","name":"Files","url":"https://files.ieoc.top","iconType":"preset","icon":"folder"},{"id":"v2ray","name":"V2Ray","url":"https://v2ray.ieoc.top","iconType":"preset","icon":"rocket"},{"id":"cassos","name":"Cassos","url":"https://cassos.ieoc.top","iconType":"preset","icon":"code"},{"id":"163","name":"163","url":"https://163.ieoc.top","iconType":"preset","icon":"mail"},{"id":"jenkins","name":"Jenkins","url":"https://jenkins.ieoc.top","iconType":"preset","icon":"wrench"},{"id":"emby","name":"Emby","url":"https://emby.ieoc.top","iconType":"preset","icon":"play"},{"id":"qb","name":"QB","url":"https://qb.ieoc.top","iconType":"preset","icon":"download"},{"id":"alist","name":"Alist","url":"https://alist.ieoc.top","iconType":"preset","icon":"list"},{"id":"halo","name":"Halo","url":"https://halo.ieoc.top","iconType":"preset","icon":"globe"},{"id":"wireguard","name":"WireGuard","url":"http://106.75.241.220:51821/","iconType":"preset","icon":"lock"},{"id":"gh-proxy","name":"GH-Proxy","url":"https://gh-proxy.ieoc.top/","iconType":"preset","icon":"link"}],"background":{"type":"color","value":"#181818"}}');
