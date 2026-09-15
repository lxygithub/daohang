# daohang · 个人导航站

一个自托管的「Aurora Glass」风格导航/起始页，基于 Vue 3 + Vite + Cloudflare Pages（Functions + D1）。支持多用户注册、按账号云同步书签与偏好、管理员用户管理、邮箱找回密码——全部功能都跑在 Cloudflare 免费额度内。

线上示例：https://daohang.ieoc.top

## 功能总览

### 导航核心

- 图标 / 卡片 / 列表三种布局，手机式分页网格；拼音声母分组字母视图
- 拖拽排序（含跨组）、分组折叠、按使用频率自动排序
- 粘贴链接自动抓取标题与 favicon（公网站点服务端抓取失败时浏览器二次兜底；内网地址自动改用浏览器直连探测，裸地址如 `192.168.1.10:5000` 自动补 `http://`，标题读不到时按端口预填服务名）；图标支持上传 / URL（可配置自建图床，图标与壁纸上传自动转外链而非 base64 内联，存量内联资源可在设置里一键转存）；长按（移动端）或右键（桌面）进编辑模式
- 内置导航目录：15 分类 110+ 常用站点，菜单入口一键浏览、搜索、按 URL 去重添加；站点图标加载失败自动回退首字文字图标
- 搜索：本地过滤与建议、多引擎切换（本地/百度/必应/Google/Yahoo/Yandex）、自定义 `{q}` 占位引擎、新标签直达

### 个性化

- 极光背景 + 玻璃卡片 + 大时钟 Hero（农历 / 节气 / 节日）
- 壁纸：Bing 每日精选（风车按钮随机换）、图片 URL、本地上传（自动压缩至 1440px）、可视化渐变编辑器、模糊度滑块
- 暗色 / 亮色主题；字号、字色、文字阴影可调；搜索框大小 / 圆角 / 不透明度可调
- 一言名句（可自定义文案与样式）

### 账号与云同步

- 邮箱 + 密码注册登录：PBKDF2-SHA256 25000 迭代加盐；HttpOnly Cookie 会话，30 天滑动续期
- 按账号独立的服务列表与全部偏好，多设备实时同步（1.5s 防抖批量上传，LWW 时间戳解决冲突）
- 账号管理：修改密码（自动踢出其他设备）、自助注销（事务级联清除全部云端数据）；管理员账号不可注销（前端不展示入口，服务端硬拒绝）

### 管理员

- 用户列表（邮箱搜索）+ 每用户会话数 / 偏好数统计
- 重置密码、禁用/启用（禁用即刻全端下线、禁止登录与找回密码）、删除（级联清理）；管理员账号受保护不可禁用/删除/自注销
- 管理员由 `ADMIN_EMAILS` 环境变量判定，入口仅管理员可见，接口服务端双重校验

### 找回密码（Brevo 发信）

- 6 位验证码，10 分钟有效，库内仅存哈希，错 5 次作废
- 防枚举：无论账号是否存在，响应保持一致
- 走 Brevo API 发送：免费 300 封/天，无需验证域名

### 安全与可用性

- 登录 / 注册 / 发码等多维度限流（isolate 内存级，尽力而为）
- 同源校验防 CSRF；登录失败烧等量 CPU 防时序探测
- PWA（可安装、离线外壳）；回收站（误删条目保留 30 条）
- 零配置建表：D1 首次访问自动建表并幂等迁移旧库，git 推送即部署

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3（Composition API）+ Vite，无 UI 框架依赖 |
| 后端 | Cloudflare Pages Functions（Edge Workers） |
| 数据库 | Cloudflare D1（SQLite）；全部 SQL 收敛在 `functions/lib/db.js` 单适配层 |
| 邮件 | Brevo HTTP API（保留 Resend 兼容备用通道） |
| 部署 | GitHub push → Cloudflare Pages 自动构建 |

## 本地开发

```bash
npm install

# 纯前端开发（后端 API 不可用）
npm run dev

# 完整本地开发：Functions + 本地 D1 + mock 邮件
node scripts/mock-resend.mjs          # 终端 1：邮件 mock，端口 9999
npx wrangler pages dev --port 8788    # 终端 2：整站（首次访问自动建表）
```

在项目根目录创建 `.dev.vars`（已被 gitignore，不会提交）供本地注入变量：

```ini
ADMIN_EMAILS=you@example.com
RESET_MAIL_FROM="daohang <you@example.com>"
BREVO_API_KEY=local-mock
BREVO_API_BASE=http://127.0.0.1:9999
```

忘记密码验证码在本地可从 mock 获取：`curl http://127.0.0.1:9999/last-code`。

## 测试

```bash
npm run mock:resend &      # 邮件 mock 需先启动
npm run test:auth          # 注册/登录/会话/限流（16 项）
npm run test:account       # 改密/注销/管理员保护（26 项）
npm run test:admin         # 管理员 + 找回密码（30 项）
npm run test:disable       # 用户搜索 + 禁用/启用（20 项）
npm run test:upload        # 自建图床上传代理（12 项含鉴权转发，需 mock:imgbed）
npm run test:meta          # 站点标题/图标获取：GBK 解码、内网识别与直连、候选验证（40 项）
npm run test:builtin       # 内置导航目录数据完整性（12 项）
```

限流为 isolate 内存实现，多套测试连跑会触发 429，跑之前重启 wrangler 即可隔离。

## 数据备份与迁移

```bash
npm run db:export     # 导出远程 D1 → backups/（SQL dump + 全表 JSON）
npm run db:import     # 导入备份 → D1；亦可生成 PostgreSQL / MySQL / SQLite 方言 INSERT
npm run db:migrate    # 手动执行 d1/ 迁移（通常不需要，ensureSchema 会自动建表）
```

## 项目结构

```
├─ functions/            # Pages Functions 后端
│  ├─ api/               # REST 路由：auth（注册/登录/找回）、admin（用户管理）、
│  │                     #   user（改密/注销）、config、meta、favicon、wallpaper
│  └─ lib/               # db.js 数据访问层、auth.js 鉴权、mailer.js 邮件
├─ src/                  # Vue 前端
│  ├─ components/        # AuthModal / AdminModal / AccountModal / SettingsModal / ...
│  ├─ composables/       # sync.js 云同步、usePrefs / useConfig 偏好管理
│  └─ assets/            # Aurora Glass 主题样式
├─ d1/                   # SQL 迁移文件（0001 ~ 0003）
├─ scripts/              # 测试套件、db 导入导出、邮件 mock
└─ public/               # PWA manifest / sw / 图标 / 搜索引擎图标
```

## 环境变量速览

| 变量 | 配置位置 | 说明 |
|---|---|---|
| `ADMIN_EMAILS` | wrangler.toml `[vars]` | 管理员邮箱，逗号分隔可多个 |
| `RESET_MAIL_FROM` | wrangler.toml `[vars]` | 找回邮件发件人，须先在 Brevo 验证 |
| `ADMIN_PASSWORD` | 仪表板加密机密 | 管理密码；或用 `ADMIN_PASSWORD_SHA256` |
| `BREVO_API_KEY` | 仪表板加密机密 | Brevo 发信 API key |
| `RESEND_API_KEY` | 仪表板加密机密 | 可选，Resend 备用通道 |
| `IMG_UPLOAD_API` | wrangler.toml `[vars]` | 可选，自建图床上传接口；配置后图标/壁纸上传自动转外链，设置内可一键转存存量 base64（详见 DEPLOY.md） |

完整部署步骤、变量管理规则与常见问题见 [DEPLOY.md](DEPLOY.md)，D1 细节见 [D1_SETUP.md](D1_SETUP.md)。
