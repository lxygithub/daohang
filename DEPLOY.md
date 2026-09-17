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
- ⏳ **唯一未完成：D1 差量导入 19,615 行**（把 D1 站点表的 icon 字段刷成图床外链）。09-17 执行时被「账户当日 D1 写额度耗尽」阻塞（根因见下文 09-17 事故），**北京时间 08:00（UTC 零点）额度重置后一条命令收尾**：

  ```bash
  CLOUDFLARE_API_TOKEN=<D1:Edit权限的token> node scripts/d1-direct-import.mjs --run   # ~5-8 分钟
  CLOUDFLARE_API_TOKEN=<...> node scripts/d1-direct-import.mjs --check               # 预检（只读，不耗写额度）
  ```

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

Pages 项目 → Custom domains → Set up a custom domain，按提示在域名 DNS 处添加 CNAME 记录指向 `你的项目.pages.dev`，证书自动签发。国内访问建议套一层自选优选 CDN 或使用已备案域名直连。

## 九、常见问题（FAQ）

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

**图床外链打不开/显示 404？**
先查链接是否带 **`/file/` 前缀**——cfbed 的文件服务路由是 `https://img-bed.ieoc.top/file/<目录>/<文件名>`；不带前缀的路径会命中图床前端 SPA 的兜底页（HTTP 200 但 content-type 是 text/html，页面渲染成 404 视图，极具迷惑性）。自检方法：`curl -sI <链接>` 看 content-type 是否 `image/*`。2026-09-16 实测：`/meizitu/xxx.png` 404 假象 ↔ `/file/meizitu/xxx.png` 200 image/png，文件本身一直健在；复制链接用面板「复制链接」或上传响应的 `src` 字段（自带 /file/），外链工具（PicGo 等）自定义 URL 前缀时记得补上。

**上传图标提示「图床未配置 / 已改用内联保存」？**
前者说明 `IMG_UPLOAD_API` 还没配置（或配置后未重新部署）；后者是图床返回了错误——先用 curl 直接测图床接口（`curl -F file=@1.png https://图床/upload`），按其响应调整字段名（`IMG_UPLOAD_FIELD`）与鉴权（`IMG_UPLOAD_TOKEN` / `IMG_UPLOAD_QUERY`）；也可在 Brevo 之外看图床服务日志。回退机制下图标仍会保存，不影响使用。

**仓库公开安全吗？**
机密（API key、密码）按规范只存在于仪表板加密变量中，`wrangler.toml` 与代码里不含任何机密；`.dev.vars` 已被 gitignore。

## 十、SQL Gateway 接入（内网数据库查询）

本项目可通过自建 SQL Gateway 查询内网数据库（PostgreSQL / MySQL），用于「导航站展示内网业务数据」这类需求。网关的完整协议、坑与运维见 `sql-gateway` 仓库《使用与接入指南》，本章只写 daohang 侧的现状与开通步骤。

**链路与信任边界**（浏览器永远不直接接触网关）：

```text
daohang Pages Functions（可信服务端）
  → Cloudflare WAF（只放行 ieoc.top / ieop.top 两个 Worker Zone）
  → db-gateway.ieop.top → Tunnel → Nginx → 127.0.0.1:8787 Gateway → 内网库
```

**本仓库已就位的代码**：

- `functions/lib/gateway.js` —— `gatewayQuery(env, target, mode, statements)` 客户端：BigInt 归一化（指南坑 1）、单请求 20 条语句 / 256 KiB 上限前置校验、错误保留 `error + requestId`、超时 10s；
- `functions/api/gateway/ping.js` —— 接入验证探针（仅管理员，`POST /api/gateway/ping`）：发一条无副作用的 `SELECT 1`（read-only），返回 `durationMs / rows / requestId`；
- `wrangler.toml [vars]`：`SQL_GATEWAY_URL`（网关地址）与 `SQL_GATEWAY_TARGET`（默认 `forgotit-postgres`，按需改）。

**开通还需两步人工配置**（代码 push 不够，这两步分别在 CF 控制台与服务器上做；未完成前探针返回 502，属预期）：

1. **WAF 放行 daohang 的 Zone**：`ieop.top` Zone → Security → WAF → 编辑 `db-gateway.ieop.top` 的 Block 规则表达式，把调用方 Zone 加入放行集合：

   ```text
   (http.host eq "db-gateway.ieop.top" and not (cf.worker.upstream_zone in {"ieop.top" "ieoc.top"}))
   ```

2. **服务器侧放行 target**：在 `/etc/sql-gateway/gateway.config.json` 的 `clients.forgotit-worker.targets` 中，为 daohang 实际要用的 target 补允许模式（先只给 `read-only`），然后 `sudo systemctl restart sql-gateway` 并本机 `curl http://127.0.0.1:8787/readyz` 确认。

**验证三连**：

- 管理员登录 daohang → 控制台/前端调 `POST /api/gateway/ping`（带同源 Cookie），返回 `ok: true` 即全链路打通；
- 非 Worker 环境（浏览器直接开、`curl https://db-gateway.ieop.top/v1/query`）应得到 Cloudflare **403**——这是 WAF 在按设计拦截，不是故障；
- 服务器 `grep "POST /v1/query" /var/log/nginx/access.log` 能看到 UA 为 `Go-http-client/2.0` 的记录（指南坑 3：access log 不含 `$host`，别按域名 grep）。

**使用纪律**（违反会在网关/数据库侧被打回）：

- 查询一律走 `gatewayQuery`，值放进 `params`（PG 用 `$1`，MySQL 用 `?`），绝不拼接用户输入；排序字段等标识符用固定白名单映射；
- 新需求先 `read-only`，确有写需求再逐点申请 `read-write`；表结构变更走数据库 owner 的迁移流程，应用运行时做不了 DDL（指南坑 2：`CREATE TABLE IF NOT EXISTS` 在权限校验阶段即失败）；
- 直连报 403 是预期（坑 4）；「调用方报连不上 + 网关零日志」先查客户端序列化（坑 1，本仓库已在 `gateway.js` 内处理），不要先查 WAF。
