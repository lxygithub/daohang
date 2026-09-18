# 部署指南

本文档覆盖从零把 daohang 部署到 **Cloudflare Workers**（静态资源 + Pages Functions 编译产物）的完整流程：内网 PostgreSQL（经 SQL Gateway）为主、D1 为备份、环境变量与机密、Brevo 发信配置、管理员设置与常见问题排查。

> 2026-09-17 起本项目由 Pages 项目改为 Worker，原因与迁移细节见「十一、从 Pages 迁移到 Worker」。

前置条件：一个 Cloudflare 账号、一个 GitHub 账号（代码仓库私有/公开均可）。

## 一、五步快速部署

1. **准备数据库**（内网 PostgreSQL，经 SQL Gateway）：用 owner 执行 `scripts/pg-schema.sql`（建 `daohang` schema + 表 + 给网关 ro/rw 账号授权），再用 `scripts/d1-to-pg.mjs` 导数据，细节见「十、SQL Gateway 接入」。
2. **推送代码到 GitHub**：仓库含 `wrangler.toml`（Worker 配置：`main`、`[assets]`、`[[d1_databases]]`、`routes`）。
3. **创建 Worker**：控制台 → Workers & Pages → Create → Connect to Git，选中仓库；Root directory 留空，Build command `npm run build`（= `vite build` + `wrangler pages functions build`），Deploy command `npx wrangler deploy`。
4. **配置机密**：`npx wrangler secret put BREVO_API_KEY`（Brevo **API Key**，`xkeysib-` 开头）与 `npx wrangler secret put IMG_UPLOAD_TOKEN`（图床 token）。明文变量写在 `wrangler.toml` 的 `[vars]`。
5. **绑域名**：在 `wrangler.toml` 的 `routes` 里加 `{ pattern = "<域名>/*", zone_name = "<Zone>" }`，再 `npx wrangler deploy`。用法与坑见「八、自定义域名」。

> D1 绑定保留为迁移期备份/回退源；切换后不再写入 D1。老版本（D1 直连）的部署方式见「十一」的迁移说明。

## 二、环境变量管理规则（Worker 形态）

变量分两类：

- **明文变量（Plaintext）**：写在 `wrangler.toml` 的 `[vars]` 里，随部署生效。
- **机密（Secrets）**：`npx wrangler secret put <NAME>`，或 Dashboard → Worker → Settings → Variables and Secrets 加密添加；与 `[vars]` 运行时自动合并。

> 机密**不随代码迁移**：Pages 项目与 Worker 是两个资源，Pages 上的加密变量在改成 Worker 后需要重设一遍（2026-09-17 迁移时 `BREVO_API_KEY`、`IMG_UPLOAD_TOKEN` 各重设了一次）。

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

编辑弹窗「上传图标」与设置抽屉「上传图片（壁纸）」默认把图片以 base64 内联进配置 JSON，图标/壁纸多了会让配置变大、同步变慢。若你已自建图床（如基于 Telegram Bot 的开源项目），配置以下变量后，上传会自动改为先传图床、把返回的外链 URL 存进配置；设置抽屉还会出现「图床转存」按钮，可把存量内联资源一键换成外链：

1. `IMG_UPLOAD_API`（明文，`[vars]`）：图床上传接口完整 URL，如 `https://img.example.com/upload`。
2. `IMG_UPLOAD_FIELD`（明文，可选）：multipart 文件字段名，默认 `file`。
3. 鉴权（按你图床的要求二选一，均放仪表板加密机密）：`IMG_UPLOAD_TOKEN`（Bearer 头）或 `IMG_UPLOAD_QUERY`（查询串，如 `token=xxx`）。

约定与容错：

- 接口约定为 `POST multipart/form-data`，响应 JSON（或纯文本）中包含图片 URL 即可；解析器会递归寻找 `url / link / src / path` 等常见键，兼容绝大多数开源图床。
- 上传接口需登录会话才可调用（防匿名滥用）；单文件限 8MB、仅图片。
- 未配置 `IMG_UPLOAD_API` 或上传失败时，前端自动回退为 base64 内联保存，功能永不阻断；已保存的 base64 图标照常渲染，无需迁移。
- 「图床转存」（设置抽屉内，仅在图床已配置且有内联资源时出现）：扫描配置里 base64 内联的图标与壁纸，逐个上传图床替换为外链（相同图片只上传一次，逐项上报进度），完成后自动保存配置；失败项保留内联不丢失。需注册并登录后使用。

### 以 CloudFlare-ImgBed（MarSeventh）为例

社区常用的 Telegram 系图床 [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)，对接参数：

1. 在图床管理端拿到**上传认证码**（认证管理），或创建一个带 upload 权限的 **API Token**。
2. `wrangler.toml` 的 `[vars]`：

   ```toml
   IMG_UPLOAD_API = "https://你的图床域名/upload"
   # 文件字段名默认就是 file，无需再配 IMG_UPLOAD_FIELD
   ```

3. 仪表板加密机密（二选一）：

   - `IMG_UPLOAD_QUERY = "authCode=你的认证码"`（ImgBed 原生查询串认证）
   - 或 `IMG_UPLOAD_TOKEN = "<API Token>"`（Bearer 头）

4. push 重新部署后，上传图标/壁纸会经 `/api/upload` 转发到图床，返回的外链自动写进配置；设置抽屉用「图床转存」把存量 base64 一键换成外链。

说明：ImgBed 默认返回相对路径 `/file/xxx`，代理已自动按图床域名补全；也可在其后追加 `&returnFormat=full` 让图床直接返回完整链接。Telegram 渠道单文件上限 20MB、默认开启服务端压缩（小图标无影响）。

## 五、D1 数据库

**建表与迁移**：应用内置幂等的 `ensureSchema()`——任何 auth/config 接口首次被访问时自动创建 `users / sessions / user_data / pwd_resets / nav_config` 五张表，并对老库自动补列（如 `users.disabled`）。因此 git 推送部署即可，通常不需要手动迁移；如需手动执行：`npm run db:migrate`。

**备份与搬家**：

```bash
npm run db:export     # 远程 D1 → backups/（SQL dump + 全表 JSON）
npm run db:import     # 备份 → D1；可生成 PostgreSQL / MySQL / SQLite 方言
```

建议定期 `db:export` 留存备份（D1 免费档无自动快照）。

**换库**：全部 SQL 收敛在 `functions/lib/db.js` 单适配层，使用标准 SQLite 方言与 ISO-8601 文本时间戳，迁移到其他 SQLite 兼容库成本最低。

## 六、内置导航站点库（自维护）

站点库数据源为 inftab（Infinity 新标签页）公开图标库，全量 ~2 万站点存 D1，前端「新增项目 → 站点库」可搜索/分类挑选。维护流程（本机即可，无需 wrangler 登录）：

```bash
npm run builtin:crawl    # 1. 分页抓取 15 个分类（断点续爬，数据在 scripts/data/，不入库）
npm run builtin:merge    # 2. 清洗去重 → builtin-sites.json
npm run icons:rehost     # 3. 图标转存自建图床 builtin-icons/ 目录（断点续传，限流+去重内置）
npm run icons:prefetch   # 3.1 可选：把待转存图标预下载到本地（供离线打包本地上传套件）
npm run icons:audit      # 3.5 可选：已转存图标拉回本地按内容哈希审计重复 + 重建去重索引（只读图床）
npm run icons:apply      # 4. 把转存结果写回 → builtin-final.json（失败项回退原始 CDN 直链）
npm run builtin:import   # 5. 全量导入 D1（upsert 幂等，需先 re-arm 密钥）；增量升级图标加 --delta
```

> **本地上传套件**：沙箱/服务器网络受限时，可把待转存图标预下载后打包（`scripts/build-rehost-kit.py`，
> 内含 `scripts/rehost-local.mjs` 上传脚本 + 进度/去重索引 + 图标文件），下载到本地电脑执行
> `node rehost-local.mjs upload` 续跑——限流/去重/断点续传逻辑与 `icons:rehost` 完全一致，跑完 `apply`
> 把 `builtin-final.json` 发回即可进入收尾流程。

**当前进度快照（2026-09-17）**：

- ✅ **图标转存完成**：19,175 / 19,178 个唯一图标源已上图床（99.98%）。未上图床的 3 个源均为源数据本身损坏（`/undefined` 路径、双斜杠 404、截断文件、<50B 垃圾图），apply 时自动回退原始直链，无补传价值。
- ✅ **icons:apply 完成**：`scripts/data/builtin-final.json` 已重新生成——19,626 站中图床外链 19,615、回退原始直链 11。
- ✅ 去重复核：已转存图标中真正内容重复仅 25 个（≈1%），同色系/同风格 logo 的视觉相似非重复；2,503 份内容快照缓存于 `scripts/data/icon-cache/`（内容寻址，兼作备份）。
- ✅ **图标已写回生产库（2026-09-17 晚）**：数据层此时已切到 PostgreSQL，D1 差量导入不再需要；
  直接在 PG 上回填了 **16,853 行** `icon`（方法见「十二、图床收尾」），当前 18,432 条走图床、1,194 条回退原始直链。
- ⏳ **图床去重未完成**：`builtin-icons/` 有 29,667 个文件、实际只用到 16,536 个内容，多余的是历次重复上传。
  扫描进度 22,714 / 29,667 已缓存，**明天（D1 写额度恢复后）继续**，详见「十二」。

  导入完成即全量生效（当前线上仍是 09-15 的 1,578 条老外链，站点功能正常，仅图标未更新）。

**转存脚本 v3（`scripts/rehost-v3.mjs`）**——断点续传 + hash 内容去重，可反复执行直至清零：

| 子命令 | 作用 |
|---|---|
| `status` | 进度统计（已上图床/失败待重试/未处理） |
| `backfill-hash [--conc=10]` | 从图床下载已传图标 → sha1 回填 hash 索引（跨轮去重核心，幂等） |
| `prefetch [--budget=540] [--conc=12]` | 下载待转存源图标 → 内容寻址缓存（sha1 命名） |
| `upload [--conc=6] [--budget=540] [--delay=0]` | hash 去重上传：同内容只传一次，其余直接复用 URL |
| `apply` | 生成 builtin-final.json（失败项回退原始直链） |

- 断点续传文件（`scripts/data/`）：`rehost-state.jsonl`（src→外链账本，**失败行重跑自动重试**，`perm:true` 永久失败自动跳过）、`prefetch-src-map.json`（src→sha1 映射）、`icon-hash-index.json`（内容指纹→外链）、`prefetch-icons/`（内容寻址本地缓存）。
- `--budget` 为前台时间预算（秒），到点优雅收尾落盘——适配禁止后台进程的执行环境，靠反复调用推进。
- 09-17 实跑：conc 6→12→24→32 逐级加压（图床全程无 flood，失败率 <0.7%），总耗时约 70 分钟。
- 转存脚本矩阵：**v3**（沙箱前台分段跑，本次转存主力）｜`npm run icons:rehost`（熔断版：内置全局限流——默认并发 6、全局间隔 ≥150ms、502/1102/429 全员指数退避冷却，适合无人值守慢速跑；图床已解除限速时实测 conc=32 亦稳定）｜`build-rehost-kit.py` 本地套件（见上）。

**D1 直导脚本（`scripts/d1-direct-import.mjs`）**——**当前推荐导入路径**：绕过「Pages secret 改后需重新部署才生效」的限制，直接走 D1 REST API 执行与 import API 逐字一致的 `json_each` upsert SQL（`ON CONFLICT(url)` 全字段刷新）。仅 upsert `builtin_sites` 行、不动分类关联（省 ~4 万行写额度）。需要具备 **D1:Edit** 权限的 CF API Token（经环境变量 `CLOUDFLARE_API_TOKEN` 传入，勿写进文件）。⚠️ D1 query API 单参数约 1MB 上限——脚本已按 150 行/批规避；大规模差异检查需分批拉回本地求差（脚本已内置）。

**导入密钥（re-arm / disarm，备选路径）**：仅在「无 CF Token、只动手改 wrangler.toml」时使用。导入端点 `/api/builtin-sites/import` 由 `wrangler.toml [vars]` 的 `BUILTIN_IMPORT_KEY` 门禁。仓库公开，密钥只在导入窗口临时存在：导入前在该文件加回一行 `BUILTIN_IMPORT_KEY = "<openssl rand -hex 32 生成>"` 并同步写进 `scripts/data/import-key.txt`（**每次 re-arm 都必须生成新值**：2026-09-15 之前武装用的那枚密钥已随提交 619bcf0 进入公开 Git 历史，视为已泄露——`import-key.txt` 里的旧值同样作废，不可复用），推送部署后跑 `npm run builtin:import`，完成后立即删除该行再推送（disarm）。密钥暴露窗口 ≈ 导入窗口（分钟级），端点仅可写站点库两表且有行数上限。

**额度注意**：D1 免费档每日 10 万行写入，**UTC 零点重置 = 北京时间早上 8 点**（不是国内零点）。行写入账目：全字段导入 ≈ 3 行/站（站点 upsert + 分类关联清插）、**仅图标差量（--delta，icons:true）= 1 行/站**；触发限额的表现：登录/注册/保存配置报 `D1_ERROR: exceeded free tier daily row write limit`，**读取不受影响**（浏览/站点库/搜索正常），次日自动恢复，无法提前解除。图标转存（rehost）不写 D1（仅上传图床；仅当 cookie 失效时注册服务账号产生 2-3 行）。

**事故记录（2026-09-15）**：一天内连续跑了全量导入（≈4 万行）+ 前期失败导入尝试（已写行不退回）+ delta 导入 + 测试流量，把当日 10 万行打满，站点写功能瘫痪到次日。教训已固化两层防护：

1. **脚本护栏**：`import-builtin.mjs` 启动时估算行写入（全字段 3 行/站、差量 1 行/站），> 5 万行直接拒绝执行（零网络请求），确认额度充足需显式加 `--force`；`--dry-run` 可离线预检模式与行数，不碰网络。
2. **操作纪律**：一个 UTC 日最多跑一波大批量导入；全量导入已完成、**永远不要再跑**；转存完成后那次收尾 delta 导入（仅图标模式约 1.6 万行，额度压力已大幅下降）仍建议单独挑一个新鲜的日子跑，当天不要叠加其它大批量写操作。

若后续确有频繁批量写入需求：升级 Workers Paid（$5/月）可解除每日 10 万行上限；日常小量写入（登录/保存配置/日常增量）免费档完全够用。

**事故记录（2026-09-17，新教训：大上传日 ≠ 导入日）**：图标转存当天下午紧接着跑导入，首批即报额度耗尽（UTC 窗口仅开 2 小时）——真凶是**转存上传本身**：图床（CloudFlare-ImgBed）每收一张图，都要向同一账户的 D1（img_d1 库）写入 `files` + `index_operations` + KV 兼容层多行，1.66 万张上传 ≈ 消耗数万行，与导入共用每日 10 万行账户级额度。**纪律补充：同一天既大批量转存又做导入必然撞墙，排期错开。**

**图床端遗留清理（低优先级）**：图床上存在同内容重复文件，两个成因：①502 风暴期「上传成功但响应丢失→重试」产生的孤儿文件（从未记录在状态文件）；②09-16 第二轮约 3,764 张的上传记录随沙箱回滚丢失（URL 无从恢复），本轮重传产生同内容重复。v3 上传文件名为确定性 `{sha1}.{ext}`（图床外链形如 `{时间戳}_{sha1}.{ext}`），**图床管理端按文件名后缀排序即可筛出同 sha1 重复**：保留最新一条、删除其余。若可提供图床管理 API Token，也可脚本化对账清理。

## 七、管理员

- 管理员 = `ADMIN_EMAILS` 中列出的邮箱。用该邮箱**注册/登录**后，用户菜单出现「用户管理」入口。
- 用户管理支持：邮箱搜索、查看每用户会话/偏好数、重置密码（强制改密并踢全部设备）、禁用/启用（禁用即刻全端下线且无法登录、无法找回密码）、删除（事务级联清理，不可恢复）。
- 管理员账号（含自己）不可被禁用或删除，前端按钮与服务端双重保护。
- 回退行为：`ADMIN_PASSWORD` 与 `ADMIN_PASSWORD_SHA256` 都未配置时，服务端回退内置默认密码（与历史仓库一致）——**首次部署后请立刻在仪表板配置加密机密**。

## 八、自定义域名（可选）

Worker 用 **zone route** 绑域名，写在 `wrangler.toml`：

```toml
routes = [
  { pattern = "daohang.ieop.top/*", zone_name = "ieop.top" },
]
```

`npx wrangler deploy` 时生效，复用现有 DNS 解析，不需要改任何 DNS 记录，证书自动签发。

两个实战坑：

1. **不要用 `custom_domain = true`**：如果该主机名上已有 Pages 时代留下的 A/CNAME 记录（已代理），绑定会失败并报
   `100117 Hostname already has externally managed DNS records`。zone route 没有这个问题。
2. **接入 SQL Gateway 时，域名所属 Zone 必须被网关 WAF 放行**：网关的规则是
   `(http.host eq "db-gateway.ieop.top" and not (cf.worker.upstream_zone eq "<调用方 Zone>"))`，
   只有该 Zone 里的 Worker 子请求能通过。`daohang.ieoc.top`（`ieoc.top` Zone）就是因此必然 403，
   已于 2026-09-17 从域名中移除；要同时提供多个域名，需在 WAF 规则的白名单里补上对应 Zone。

国内访问建议套一层自选优选 CDN 或使用已备案域名直连。

## 九、常见问题（FAQ）

**没收到验证码邮件？**
按顺序排查：① 垃圾箱；② Brevo 后台 Logs 是否有发送记录与退信原因；③ 发件人是否在 Brevo Senders 验证过、与 `RESET_MAIL_FROM` 是否一致；④ 是否超出 300 封/天额度；⑤ **`BREVO_API_KEY` 是不是 `xkeysib-` 开头的 v3 API Key**——用 SMTP Key（`xsmtpsib-`）会得到 `邮件发送失败（401）`，这是 2026-09-17 实测踩到的坑。机密是即时生效的，不需要重新部署。

**管理密码不对？**
管理员不是独立密码，而是**用你自己的账号登录、且邮箱在 `[vars] ADMIN_EMAILS` 里**（逗号分隔可多个）；满足即出现「用户管理」入口。历史文档里的 `ADMIN_PASSWORD` 机密已无代码读取，可忽略。

**接口报 500 no such table？**
运行时不建表。若换库或清库，需在服务器以 owner 执行 `scripts/pg-schema.sql`；应用的 `ensureSchema` 只做探测，缺表时会直接抛出「数据库缺表: xxx —— 请先执行 scripts/pg-schema.sql」。

**改了 `[vars]` 不生效？**
`wrangler.toml` 的变量在部署时注入，改完要 `npx wrangler deploy`（或 push 触发 Workers Builds）。**机密不用**：`wrangler secret put` 后立即生效。

**频繁 429？**
登录/注册/发码有限流（isolate 内存级）。生产单人使用不会触达；本地连跑多套测试会耗尽配额，重启 wrangler 即可。

**图床外链打不开/显示 404？**
先查链接是否带 **`/file/` 前缀**——cfbed 的文件服务路由是 `https://img-bed.ieoc.top/file/<目录>/<文件名>`；不带前缀的路径会命中图床前端 SPA 的兜底页（HTTP 200 但 content-type 是 text/html，页面渲染成 404 视图，极具迷惑性）。自检方法：`curl -sI <链接>` 看 content-type 是否 `image/*`。2026-09-16 实测：`/meizitu/xxx.png` 404 假象 ↔ `/file/meizitu/xxx.png` 200 image/png，文件本身一直健在；复制链接用面板「复制链接」或上传响应的 `src` 字段（自带 /file/），外链工具（PicGo 等）自定义 URL 前缀时记得补上。

**登录状态下刷新会闪一下登录页？**
`authed` 初始值是 `false`，它只代表「还没问过服务端」，不等于未登录。修复前「请登录…」占位直接挂在
`v-else-if="!authed"` 上，而鉴权那一趟网关往返要 1～2s，于是先渲染未登录态再跳回网格
（2026-09-18 实测：旧逻辑在 437ms 闪出文案、883ms 才出网格）。现在 `composables/sync.js` 多了
`authChecked`（`checkAuth()` 有结果才置 true），所有「未登录」UI 都同时判断它；有本地缓存时直接出网格，
不用等鉴权。**新加未登录相关 UI 时记得带上 `authChecked`，别只判 `authed`。**

**上传图标提示「图床未配置 / 已改用内联保存」？**
前者说明 `IMG_UPLOAD_API` 还没配置（或配置后未重新部署）；后者是图床返回了错误——先用 curl 直接测图床接口（`curl -F file=@1.png https://图床/upload`），按其响应调整字段名（`IMG_UPLOAD_FIELD`）与鉴权（`IMG_UPLOAD_TOKEN` / `IMG_UPLOAD_QUERY`）；也可在 Brevo 之外看图床服务日志。回退机制下图标仍会保存，不影响使用。

**仓库公开安全吗？**
机密（API key、密码）按规范只存在于仪表板加密变量中，`wrangler.toml` 与代码里不含任何机密；`.dev.vars` 已被 gitignore。


## 十、SQL Gateway 接入与数据库切换 PostgreSQL

2026-09-17 起 daohang 运行时数据库从 Cloudflare D1（SQLite 方言、免费档 10 万行写入/日限制）切换到内网 PostgreSQL，经自建 SQL Gateway（`db-gateway.ieop.top`）访问。数据层 `functions/lib/db.js` 保持函数签名不变、内部重写为 PG 方言（`$n` 占位符 / `ON CONFLICT` / `jsonb_to_recordset`），上层路由零改动；网关的完整协议与坑见 `sql-gateway` 仓库《使用与接入指南》。

**链路与信任边界**（浏览器永远不直接接触网关；`daohang.ieop.top` 与网关同属 `ieop.top` Zone，WAF 表达式 `(http.host eq "db-gateway.ieop.top" and not (cf.worker.upstream_zone eq "ieop.top"))` 原样放行，**无需修改**）：

```text
daohang Pages Functions（可信服务端）
  → Cloudflare WAF（放行 ieop.top Zone 的 Worker 子请求）
  → db-gateway.ieop.top → Tunnel → Nginx → 127.0.0.1:8787 Gateway → 内网 PostgreSQL
```

**本仓库已就位的代码**：

- `functions/lib/gateway.js` —— `gatewayQuery()` 客户端：BigInt 归一化（指南坑 1）、单请求 20 条语句 / 256 KiB 上限前置校验、错误保留 `error + requestId`、超时 10s；
- `functions/lib/db.js` —— 全部数据访问改为经网关的 PG 版；`ensureSchema` 改为探测（应用运行时无 DDL 权限，缺表即报错并指向 `scripts/pg-schema.sql`）；读函数走网关 `read-only`、写函数走 `read-write`；`listBuiltinSites` 的 count+list 合并单次往返，级联删除 3 条语句同请求同事务；
- `functions/api/gateway/ping.js` —— 接入验证探针（仅管理员，`POST /api/gateway/ping`）：`SELECT 1`（read-only），返回 `durationMs / rows / requestId`；
- `scripts/pg-schema.sql` —— 服务器侧建表 + ro/rw 授权 DDL（owner 执行，幂等）；
- `scripts/d1-to-pg.mjs` —— D1 全表只读导出 → 生成 psql 数据导入 SQL（2026-09-17 快照：nav_config 1 / users 18 / sessions 22 / user_data 10 / pwd_resets 0 / builtin_sites 19,626 / builtin_site_cats 9,040）；
- `scripts/test-db-pg.mjs`、`scripts/test-gateway.mjs` —— mock 单测 26 项（零网络）。

**开通步骤（顺序不能反）**：

1. **服务器建库**：把 `scripts/pg-schema.sql` 里的 `__RO__`/`__RW__` 替换为 `/etc/sql-gateway/gateway.env` 中**本项目 target**（`daohang-postgres`）的只读/读写账号名，以 owner 身份在 `daohang` 库执行：
   ```bash
   sed -i 's/__RO__/forgotit_ro/g; s/__RW__/forgotit_rw/g' pg-schema.sql
   docker exec -i forgotit-postgres psql -U <owner> -d daohang -f - < pg-schema.sql
   ```
2. **搬迁数据**：`backups/daohang-pg-data.sql`（或重跑 `CLOUDFLARE_API_TOKEN=xxx node scripts/d1-to-pg.mjs` 取最新）传到服务器执行：
   ```bash
   psql -d <同一库> -f daohang-pg-data.sql
   ```
   幂等（`ON CONFLICT DO NOTHING`，重复执行只跳过已存在行）；导入后自动 `setval` 回拨三张 identity 表的序列。
3. **网关侧放行 target**：确认 `/etc/sql-gateway/gateway.config.json` 的 `clients.forgotit-worker.targets` 含 `"daohang-postgres": ["read-only", "read-write"]`（缺则补），`sudo systemctl restart sql-gateway`，本机 `curl http://127.0.0.1:8787/readyz` 确认（会逐个 target 报 ready）。

   > 2026-09-17 起改为**每项目独立库**：daohang 的表从「forgotit 库里的 daohang schema」迁到独立的
   > `daohang` 库（`pg_dump -n daohang` → 新库，数据与 schema 名都不变，应用代码零改动），
   > 账号换成 `sql_gateway_daohang_ro/rw`；跨库访问会被数据库直接拒绝，可单独备份/下线。
4. **验证探针**：管理员登录 daohang → `POST /api/gateway/ping`（带同源 Cookie）返回 `ok: true` 即全链路通；非 Worker 环境（浏览器直开、curl）得到 Cloudflare 403 是 WAF 在按设计拦截，不是故障。
5. **切换代码**：以上三步全绿后再部署本次 push 的 PG 版代码。部署后 D1 不再被写入，保留作回退源（回退 = 部署上一个 D1 版提交；窗口期的新注册/新保存不会回补，属已知代价）。

**使用纪律**（违反会在网关/数据库侧被打回）：

- 查询一律走 `gatewayQuery`，值放进 `params`（PG 用 `$1`），绝不拼接用户输入；排序字段等标识符用固定白名单映射；
- 新需求先 `read-only`，确有写需求再逐点放开；表结构变更由 owner 改 `pg-schema.sql` 在服务器执行，运行时做不了 DDL（指南坑 2：`CREATE TABLE IF NOT EXISTS` 在权限校验阶段即失败）；
- ro/rw 账号只有 `daohang` schema 内业务表的 DML 权限（含序列 USAGE），无任何 DDL/管理员权限；
- 直连报 403 是预期（指南坑 4）；「调用方报连不上 + 网关零日志」先查客户端序列化（坑 1，已在 `gateway.js` 处理），不要先查 WAF；网关 access log 不含 `$host`，按请求行 grep（坑 3）。

---

## 十一、从 Pages 迁移到 Worker（2026-09-17）

### 为什么必须迁

网关 WAF 只放行「调用方 Worker 所属 Zone」的子请求：

```
(http.host eq "db-gateway.ieop.top" and not (cf.worker.upstream_zone eq "ieop.top"))
```

forgotIt 是部署在 `ieop.top` Zone 的 Worker，天然通过；而 daohang 原来的 **Pages Functions 不满足这个条件**，
所有网关调用都拿到 Cloudflare 403 阻断页（页面上报 `Gateway BAD_RESPONSE; HTTP 403，响应非 JSON`）。
改成 Worker 后与 forgotIt 同等对待，**WAF 规则一行都不用改**。

### 迁移做法（代码零改动）

Cloudflare 官方命令 `wrangler pages functions build` 能把 `functions/` 目录编译成**单个 Worker**
（产物自带 `env.ASSETS.fetch(request)` 回退），所以 Functions 一行都不用重写：

```bash
npx vite build                                                    # → dist/（静态资源）
npx wrangler pages functions build functions --outdir=functions-worker
npx wrangler deploy
```

`wrangler.toml` 由 Pages 形态改为 Worker 形态：

```diff
-pages_build_output_dir = "dist"
+main = "functions-worker/index.js"
+
+[assets]
+directory = "dist"
+binding = "ASSETS"
+not_found_handling = "single-page-application"   # 站点是 SPA：/login、/xyz 都返回 index.html
+run_worker_first = true                          # Worker 先处理，内部再回退到 ASSETS
```

`package.json`：`build` 改为「vite build + functions 编译」两步，新增 `deploy`（= build + `wrangler deploy`），
Workers Builds 里 Build command 填 `npm run build`、Deploy command 填 `npx wrangler deploy`。

### 迁移期踩到的四个坑

1. **`run_worker_first` 必须写在 `[assets]` 里**——放顶层 wrangler 只给一条 `Unexpected fields` 警告然后忽略，
   表现为 Worker 不处理请求。
2. **别用 `custom_domain = true` 绑已有 Pages 域名的 hostname**：报 `100117 Hostname already has externally
   managed DNS records`。用 zone route（`{ pattern = "域名/*", zone_name = "Zone" }`）复用现有解析即可。
3. **机密不随代码迁移**：Worker 与 Pages 是两个资源，`BREVO_API_KEY`、`IMG_UPLOAD_TOKEN` 需在新 Worker 上重设
   （`wrangler secret put`）。Pages 上的加密变量读不出来，只能重新填。
4. **跨 Zone 的域名接不了网关**：`daohang.ieoc.top` 属 `ieoc.top` Zone，`cf.worker.upstream_zone` 不等于
   `ieop.top`，走网关必然 403；已于本次迁移中从域名移除。要多域名共存，得在 WAF 规则里补白名单。

### 回退

Pages 项目已于 2026-09-17 删除，回退路径变成以下两条：

1. **只想回退 Worker 版本**：`npx wrangler versions list` 找到上一个版本，用
   `npx wrangler versions deploy` 指定版本号回滚；或直接在 Dashboard → Worker → Deployments 里回滚。
2. **想退回 D1 数据层**：`git revert` 掉切换 PG 的那个提交（`57cc7aa`）后 push（Workers Builds 会自动部署）。
   `wrangler.toml` 里的 `[[d1_databases]]` 绑定和代码里的 D1 分支都还在，D1 数据保留着**切换到 PG 那一刻**的快照；
   切换之后的写入不会回补，属已知代价。

如果将来又想要 Pages 形态，按旧版的 `pages_build_output_dir = "dist"` + Pages 项目（构建命令 `npm run build`、
输出目录 `dist`）即可重建，但 Pages Functions 的子请求过不了网关 WAF，接入 SQL Gateway 就必须是 Worker。

---

## 十二、图床收尾：图标回填与去重（2026-09-17）

### 已完成的回填（免下载）

转存阶段把 `scripts/data/prefetch-src-map.json`（源 URL → 内容 sha1）和图床里**以 sha1 命名的文件**
（`<40位sha1>.png`）都保留了下来，两者一拼就是完整的 `源URL → 图床外链` 映射，**一张图都不用下载**：

```bash
# 1) 拉图床文件清单（表 files 里 id 才是真实路径：builtin-icons/<前缀>_<文件名>）
#    公开地址 = https://img-bed.ieoc.top/file/<id>
# 2) 取 hash 命名的文件名 → 建 hash → URL
# 3) 对库里 icon 仍非图床外链的行，用 src_map[icon].h 查到外链后 UPDATE
```

实测结果：**16,853 / 18,047 行成功回填**（93.4%），库内状态从「图床 1,579 / 原站 18,047」变为
**「图床 18,432 / 原站 1,194」**；线上站点库前 392 页（全部页）抽样均为图床外链。

剩余 1,194 条的源图标从未进入 `prefetch-src-map`（含 3 条下载即 404 的），继续用原站直链，前端有首字图标兜底。

### 两个存储后端的对应关系（重要）

图床的 `builtin-icons/` 分两批存进不同后端，**同一批上传里命名规则不同**：

| 后端（D1 metadata `Channel`） | 文件名形态 | 文件数 | 用途 |
| --- | --- | --- | --- |
| Telegram（`TelegramNew`） | `icon_<时间戳>_<随机>.png` | 7,260 | **早期**批次；库里最初的 1,579 条外链来自这批 |
| Cloudreve（`WebDAV`） | `<sha1>.png` | 22,407 | **后期**批次（sha1 命名，免下载回填就靠它） |

两者对前端完全透明（都走 `https://img-bed.ieoc.top/file/builtin-icons/...`），但**依赖不同**：
Cloudreve 那批依赖自建 Cloudreve 实例在线，Telegram 那批依赖对应 bot/频道。任一端不可用时，对应图标会 404
（前端回退首字图标）。抽查可用性：Cloudreve 10/10、Telegram 5/5 均 200。

### 去重：结果与工具

`builtin-icons/` 原有 **29,667** 个文件，按内容去重后只需要 **22,813** 个：

- **6,869** 个是重复内容，其中 **6,854 个可删**；剩下 **15 个**虽然和别人同内容，但两份都被库引用（不同行各指一份），保守起见都留着；
- 冗余大多藏在旧命名的文件里——**它们的元数据没有哈希**（`files.metadata` 只有 FileName/FileSize/Width/Height/Channel 等），
  必须下载后自己算 sha1 才能判定。

已内置只读扫描工具（不写 D1，不消耗写额度）：

```bash
# 增量扫描：给「非 sha1 命名」的文件补内容指纹，结果落 scripts/data/imgbed-content-hash.json，可反复续跑
CF_API_TOKEN=<有 D1 读权限的 token> node scripts/imgbed-dedupe.mjs scan --conc=32 --budget=420

# 出报告：按内容分组，给出可删除清单（自动排除被数据库引用的文件）
node scripts/imgbed-dedupe.mjs report
```

产物：`scripts/data/imgbed-files.json`（图床全量清单）、`imgbed-content-hash.json`（文件 id → sha1）、
`imgbed-dedupe-report.json`（重复组 + 可删除清单）。脚本的保留优先级是
**被数据库引用 > sha1 命名 > 时间戳最早**，且**凡是被 `db-referenced-ids.txt` 引用的文件一律不删**
（该清单为导出命令：`SELECT substring(icon from length('https://img-bed.ieoc.top/file/')+1) FROM daohang.builtin_sites WHERE icon LIKE 'https://img-bed.ieoc.top/%'`）。

删除工具（`scripts/imgbed-dedupe-delete.mjs`，逐批落盘、可断点续跑、自动跳过已删）：

```bash
# ⚠️ 需要 D1 写额度（UTC 零点 = 北京 08:00 重置；删除会给 files 与 index_operations 记账）
# ⚠️ 删除会同时清理 Cloudreve/Telegram 后端实体；先删 20-50 个验证一轮再批量
IMG_ADMIN_SESSION=<图床 admin_session> node scripts/imgbed-dedupe-delete.mjs --batch=50 --sleep=500
```

**去重结果（2026-09-18）**：计划内的 **6,854 个全部删除成功**，`builtin-icons` 从 29,667 → **22,813**；
逐条比对图床 `files` 表与运行库引用（19,066 个），**0 缺失**。

### 补完剩余图标（2026-09-18 完成）

原先仍在原站直链的 1,194 行（Infinity New Tab 的 `infinitypro-img` / `infinityicon` 两个 CDN）已全部转存，
用 `scripts/imgbed-backfill-rest.mjs`（下载 → 内容 sha1 去重 → 上图床；命中已有 `icon-hash-index.json` 就复用，不重复上传）：

```bash
# 1) 导出行（只读；注意是运行库 daohang，不是 forgotit 库里的 daohang schema）
docker exec -i forgotit-postgres psql -U forgotit -d daohang -t -A \
  -c "SELECT json_agg(json_build_object('id',id,'name',name,'url',url,'icon',icon)) \
      FROM daohang.builtin_sites WHERE icon NOT LIKE 'https://img-bed.ieoc.top/%'" \
  > scripts/data/pending-icons.json

# 2) 下载 + 上传（重复跑会自动重试上一轮的失败项）
DH_COOKIE='nav_session=<daohang 登录 cookie>' node scripts/imgbed-backfill-rest.mjs run --conc=6 --budget=900

# 3) 源图标本身已死的行（`/undefined` 占位、失效的 user-share-icon）改用站点自身 favicon
DH_COOKIE='...' node scripts/imgbed-backfill-rest.mjs favicon --conc=3

# 4) 落库（SQL 里带 `AND icon = '<原值>'` 守卫，幂等）
docker exec -i forgotit-postgres psql -U forgotit -d daohang -v ON_ERROR_STOP=1 < scripts/data/backfill-rest.sql
```

**结果**：内置站点库 **19,620 / 19,626**（99.97%）指向图床外链；剩下 6 条连站点自己的 favicon 都取不到，
`icon` 置空交给前端首字图标兜底（`NavCard.vue` 的 `isTextIcon` 分支），不再让浏览器去请求必死的链接。

### 本轮踩的坑

1. **daohang 的运行库是 `daohang` 数据库，不是 `forgotit` 库里的 `daohang` schema**。
   网关 `GATEWAY_DAOHANG_PG_RW_URL` 指向 `.../daohang`，Worker 侧由 `SQL_GATEWAY_TARGET=daohang-postgres` 指定；
   `forgotit` 库里那份 `daohang`/`wearwhat` schema 是当初迁移试建留下的副本（`wrangler.toml` 第 72 行有注记），
   **往它里面写等于没改**。动库前先确认库名，别只看 `\dn` 出来的 schema 列表。
   （2026-09-18：两个副本 schema 已从 `forgotit` 库删除，备份
   `/mnt/datadisk/yuan/backups/forgotit-db-leftover-schemas-20260918.sql`，验证过可完整还原。）
2. **图床批量删除内部并发是 10，会撞 D1 写锁**：`delete/batch` 一次传 500 时约一半返回笼统的
   `Delete file failed`（Telegram 31%、WebDAV 47% 的失败率接近，说明是公共环节而非后端差异）。
   降到 **批次 50 + 批间 sleep 500ms** 后，剩下 2,970 个一次跑完 **0 失败**。
3. **图床偶发 500/503**：上传（`/api/upload` 透传回来是 502）和读外链都会零星遇到，退避重试即可；
   线上抽样看到的 503 重试后都是 200，不用当成数据坏了。
4. **`db-referenced-ids.txt` 必须从运行库导出**：本轮开工时它来自那份副本，导致 1 个仍被运行库引用的文件被删
   （`1789570257011_icon_b7098d1d1dc1cc71.png`）。发现后把该行改指到同内容的保留项
   （`1789608219671_b7098d1d1dc1cc71...png`），并全量重比对，现已 0 缺失。
5. **顺手记一笔**：站点库关键词搜索修复（`q` 未映射到 `listBuiltinSites` 的 `qstr`，导致搜索返回全量），
   提交 `d3b640e`，实测 `q=Amazon → 7 条`、`q=腾讯 → 80 条`。
