# 部署指南

本文档覆盖从零把 daohang 部署到 Cloudflare Pages 的完整流程：D1 数据库、环境变量（含 2025 年起的新管理规则）、Brevo 发信配置、管理员设置与常见问题排查。

前置条件：一个 Cloudflare 账号、一个 GitHub 账号（代码仓库私有/公开均可）。

## 一、五步快速部署

1. **推送代码到 GitHub**：仓库包含 `wrangler.toml`（Pages 会据此读取配置）。
2. **创建 D1 数据库**：Cloudflare 控制台 → Storage & Databases → D1 → Create，名称建议 `daohang`。
3. **替换 database_id**：把 `wrangler.toml` 中 `d1_databases.database_id` 换成上一步生成的 id（不加 `[[d1_databases]]` 绑定则后端无法访问数据库）。
4. **创建 Pages 项目**：控制台 → Workers & Pages → Create → Pages → Connect to Git，选中仓库；构建命令 `npm run build`，输出目录 `dist`（`wrangler.toml` 已声明 `pages_build_output_dir`）。
5. **配置机密并部署**：按下文「三、环境变量」添加 `ADMIN_PASSWORD` 与 `BREVO_API_KEY` 两个加密机密，然后 Deploy。

部署完成后首次访问任意 API（如打开首页）会自动建表，无需手动执行迁移。

## 二、环境变量管理规则（2025 新政策）

Pages 项目配置 `pages_build_output_dir` 后改由 `wrangler.toml` 统一管理配置，变量分两类：

- **明文变量（Plaintext）**：只能写在 `wrangler.toml` 的 `[vars]` 里，git 部署时以该文件为准；仪表板中的明文变量会被忽略，也不可在仪表板新增。
- **机密（Secrets）**：只能通过 仪表板 → Settings → Environment variables 以「加密」方式添加，或用命令 `wrangler pages secret put <NAME>`；运行时与 `[vars]` 自动合并。

判断标准很简单：泄露即出事的（API key、密码）→ 机密；其余 → `[vars]`。

### 本项目变量清单

| 变量 | 类型 | 配置位置 | 必填 | 说明 |
|---|---|---|---|---|
| `ADMIN_EMAILS` | 明文 | wrangler.toml `[vars]` | 是 | 管理员邮箱，逗号分隔多个；这些账号登录后可见「用户管理」 |
| `RESET_MAIL_FROM` | 明文 | wrangler.toml `[vars]` | 用发信则必填 | 找回邮件发件人，格式 `名称 <邮箱>`；必须是 Brevo 已验证的发件人 |
| `ADMIN_PASSWORD` | 机密 | 仪表板加密 | 二选一 | 管理密码明文；未配置且无 SHA256 时回退内置默认，首次部署后请立即设置 |
| `ADMIN_PASSWORD_SHA256` | 明文 | wrangler.toml `[vars]` | 二选一 | 管理密码的 sha256 十六进制值（弱等价形式，仍建议优先用机密） |
| `BREVO_API_KEY` | 机密 | 仪表板加密 | 用发信则必填 | Brevo API key，`xkeysib-` 开头 |
| `RESEND_API_KEY` | 机密 | 仪表板加密 | 否 | 可选备用通道，仅当未配置 BREVO_API_KEY 时启用 |
| `IMG_UPLOAD_API` | 明文 | wrangler.toml `[vars]` | 否 | 自建图床上传接口 URL，配置后上传图标自动转外链（见下节） |
| `IMG_UPLOAD_FIELD` | 明文 | wrangler.toml `[vars]` | 否 | 图床 multipart 文件字段名，默认 `file` |
| `IMG_UPLOAD_TOKEN` | 机密 | 仪表板加密 | 否 | 图床鉴权，以 `Authorization: Bearer` 发送 |
| `IMG_UPLOAD_QUERY` | 机密 | 仪表板加密 | 否 | 图床查询串鉴权（如 `token=xxx`） |

注意：修改 `[vars]` 后需要重新部署（push 一次或在 Pages 控制台 Retry deploy）才会生效；机密同理。

## 三、Brevo 发信配置（找回密码）

Brevo 免费档每天可发 300 封交易邮件，**无需验证自有域名**，只需验证发件人邮箱：

1. 注册 [brevo.com](https://www.brevo.com)（免费计划即可）。
2. 进入 **Senders & IP → Senders**，添加并验证发件人邮箱（会收到确认邮件，点击确认链接）。
3. 进入 **SMTP & API → API Keys**，生成一个 v3 API key（`xkeysib-` 开头）。
4. 在 Pages 项目仪表板添加加密机密 `BREVO_API_KEY`。
5. 在 `wrangler.toml` 的 `[vars]` 里设置 `RESET_MAIL_FROM = "daohang <已验证的邮箱>"`，push 重新部署。

投递说明：

- 未验证域名时邮件大概率进入用户**垃圾箱**，这是无域名免费发信的普遍现象，验证码邮件模板已提示用户检查垃圾箱。
- 发送记录可在 Brevo 后台 **Transactional → Statistics / Logs** 查看，排查「没收到邮件」先看这里。
- 想提升到达率：在 Brevo 验证自有域名（添加 SPF/DKIM DNS 记录），发件人换成 `noreply@你的域名`。
- 本地开发不必配真实 key，用 `scripts/mock-resend.mjs` 模拟即可（见 README「本地开发」）。

## 四、自建图床上传（可选）

编辑弹窗「上传图标」默认把图片裁剪后以 base64 内联进配置 JSON，图标多了会让配置变大。若你已自建图床（如基于 Telegram Bot 的开源项目），配置以下变量后，上传会自动改为先传图床、把返回的外链 URL 存进配置：

1. `IMG_UPLOAD_API`（明文，`[vars]`）：图床上传接口完整 URL，如 `https://img.example.com/upload`。
2. `IMG_UPLOAD_FIELD`（明文，可选）：multipart 文件字段名，默认 `file`。
3. 鉴权（按你图床的要求二选一，均放仪表板加密机密）：`IMG_UPLOAD_TOKEN`（Bearer 头）或 `IMG_UPLOAD_QUERY`（查询串，如 `token=xxx`）。

约定与容错：

- 接口约定为 `POST multipart/form-data`，响应 JSON（或纯文本）中包含图片 URL 即可；解析器会递归寻找 `url / link / src / path` 等常见键，兼容绝大多数开源图床。
- 上传接口需登录会话才可调用（防匿名滥用）；单文件限 8MB、仅图片。
- 未配置 `IMG_UPLOAD_API` 或上传失败时，前端自动回退为 base64 内联保存，功能永不阻断；已保存的 base64 图标照常渲染，无需迁移。

## 五、D1 数据库

**建表与迁移**：应用内置幂等的 `ensureSchema()`——任何 auth/config 接口首次被访问时自动创建 `users / sessions / user_data / pwd_resets / nav_config` 五张表，并对老库自动补列（如 `users.disabled`）。因此 git 推送部署即可，通常不需要手动迁移；如需手动执行：`npm run db:migrate`。

**备份与搬家**：

```bash
npm run db:export     # 远程 D1 → backups/（SQL dump + 全表 JSON）
npm run db:import     # 备份 → D1；可生成 PostgreSQL / MySQL / SQLite 方言
```

建议定期 `db:export` 留存备份（D1 免费档无自动快照）。

**换库**：全部 SQL 收敛在 `functions/lib/db.js` 单适配层，使用标准 SQLite 方言与 ISO-8601 文本时间戳，迁移到其他 SQLite 兼容库成本最低。

## 六、管理员

- 管理员 = `ADMIN_EMAILS` 中列出的邮箱。用该邮箱**注册/登录**后，用户菜单出现「用户管理」入口。
- 用户管理支持：邮箱搜索、查看每用户会话/偏好数、重置密码（强制改密并踢全部设备）、禁用/启用（禁用即刻全端下线且无法登录、无法找回密码）、删除（事务级联清理，不可恢复）。
- 管理员账号（含自己）不可被禁用或删除，前端按钮与服务端双重保护。
- 回退行为：`ADMIN_PASSWORD` 与 `ADMIN_PASSWORD_SHA256` 都未配置时，服务端回退内置默认密码（与历史仓库一致）——**首次部署后请立刻在仪表板配置加密机密**。

## 七、自定义域名（可选）

Pages 项目 → Custom domains → Set up a custom domain，按提示在域名 DNS 处添加 CNAME 记录指向 `你的项目.pages.dev`，证书自动签发。国内访问建议套一层自选优选 CDN 或使用已备案域名直连。

## 八、常见问题（FAQ）

**没收到验证码邮件？**
按顺序排查：① 垃圾箱；② Brevo 后台 Logs 是否有发送记录与退信原因；③ 发件人是否在 Brevo Senders 验证过、与 `RESET_MAIL_FROM` 是否一致；④ 是否超出 300 封/天额度；⑤ 变量是否在 push/重新部署后才配置（需再部署一次生效）。

**管理密码不对？**
确认仪表板加密机密 `ADMIN_PASSWORD` 已添加，且添加后项目重新部署过。若两者都未配置会回退内置默认——请尽快设置并保持和仓库历史值不同。

**接口报 500 no such table？**
理论上不会出现（自动建表）；若手动清过库或换了数据库，访问一次首页触发 `ensureSchema`，或 `npm run db:migrate` 手动执行迁移。

**改了 `[vars]` 不生效？**
`wrangler.toml` 的变量在部署时读取，push 一次或在控制台 Retry deploy。仪表板加密机密同样要重新部署才注入。

**频繁 429？**
登录/注册/发码有限流（isolate 内存级）。生产单人使用不会触达；本地连跑多套测试会耗尽配额，重启 wrangler 即可。

**上传图标提示「图床未配置 / 已改用内联保存」？**
前者说明 `IMG_UPLOAD_API` 还没配置（或配置后未重新部署）；后者是图床返回了错误——先用 curl 直接测图床接口（`curl -F file=@1.png https://图床/upload`），按其响应调整字段名（`IMG_UPLOAD_FIELD`）与鉴权（`IMG_UPLOAD_TOKEN` / `IMG_UPLOAD_QUERY`）；也可在 Brevo 之外看图床服务日志。回退机制下图标仍会保存，不影响使用。

**仓库公开安全吗？**
机密（API key、密码）按规范只存在于仪表板加密变量中，`wrangler.toml` 与代码里不含任何机密；`.dev.vars` 已被 gitignore。
