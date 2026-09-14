# D1 数据库设置指南

## 1. 创建 D1 数据库

```bash
wrangler d1 create daohang
```

记录返回的 `database_id`。

## 2. 更新 wrangler.toml

将 `wrangler.toml` 中的 `YOUR_DATABASE_ID` 替换为实际的 database_id。

## 3. 执行迁移

```bash
wrangler d1 execute daohang --file d1/0001_init.sql
```

或者本地开发时使用：

```bash
wrangler d1 execute daohang --local --file d1/0001_init.sql
```

## 4. 部署

```bash
wrangler pages deploy .
```

## 5. 本地开发

```bash
wrangler pages dev .
```

## 迁移 KV 数据（可选）

如果需要从现有 KV 迁移数据到 D1：

```bash
# 获取 KV 数据
wrangler kv:key get nav_config

# 然后手动插入到 D1
wrangler d1 execute daohang --command "INSERT OR REPLACE INTO nav_config (id, config_json) VALUES (1, '<上面获取的 JSON>');"
```
