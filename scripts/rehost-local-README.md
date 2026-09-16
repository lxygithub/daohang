# 图标转存 · 本地上传包

把内置站点库（inftab 采集的 ~1.9 万站点）的图标从源 CDN 转存到你的自建图床
（img-bed.ieoc.top，经 daohang.ieoc.top 的上传代理）。**在你自己的电脑上运行**，
沙箱里已经把待转存的图标文件全部预下载好了，本地跑不依赖外网源站。

## 包内容

```
rehost-local/
├── rehost-local.mjs        # 上传脚本（本文件同目录执行）
├── README.md               # 本说明
├── icons/                  # 预下载好的待转存图标（内容寻址 <sha1>.<ext>）
└── data/
    ├── builtin-sites.json      # 19,626 个站点清单（含原始图标 URL）
    ├── prefetch-src-map.json   # 源 URL → 本地图标文件的映射
    ├── icon-hash-index.json    # 内容哈希 → 图床外链（已传内容索引，秒传用）
    └── rehost-state.jsonl      # 转存进度（沙箱已完成 ~3,257 条，断点续传）
```

## 运行要求

- Node.js **18 或更高**（用到内置 fetch / FormData / Blob，无任何第三方依赖）
- 能访问 `https://daohang.ieoc.top`（上传走它的代理，无需登录——脚本自动注册服务账号）

## 使用

```bash
node rehost-local.mjs status    # 看进度
node rehost-local.mjs upload    # 开始转存（可反复跑，断了重跑即续传）
# ……跑到 status 显示剩余 0 为止
node rehost-local.mjs apply     # 生成 data/builtin-final.json
```

预计耗时：默认限流下约 **3.5~4.5 小时**（1~1.3 个/秒），挂后台跑着就行，
中断了随时重跑 `upload` 继续。

## 内置的保护机制（请勿绕过）

1. **全局限流**：任意两次上传间隔 ≥150ms（约 6.6 次/秒硬上界，与并发无关）；
   默认并发 6。图床是 Cloudflare Worker + Telegram 存储，高频写入会触发防护。
2. **自适应冷却**：遇到 502/1102/429，全员自动暂停并指数退避（2→30 秒），
   连续成功才解除——看到告警不用管，脚本自己会降速再爬起来。
3. **内容去重**：上传前按内容 SHA-1 查 `icon-hash-index.json`，同内容只传一次
   （"秒传"直接复用已有外链）；文件名按内容哈希生成，重试不会产生重复文件。

## 跑完之后

1. `node rehost-local.mjs apply` 生成 `data/builtin-final.json`；
2. 把 **`data/builtin-final.json`**（以及 `data/rehost-state.jsonl`、
   `data/icon-hash-index.json`）发回，后续在沙箱/线上做收尾：
   re-arm 导入密钥 → `npm run builtin:import -- --delta`（仅图标差量，
   约 1.6 万行 D1 写入，需挑一个新鲜的 UTC 日）→ disarm。

## 常见问题

- **失败项**：源站 404 等永久失败会记为 `ok:false`，重跑不会自动重试；
  数量少可忽略（apply 时这些站回退原始直链，前端有文字图标兜底）。
- **想中断**：Ctrl+C 即可，进度每条都落盘。
- **换网络/换电脑**：整个目录拷走即可，状态全在本地文件里。
