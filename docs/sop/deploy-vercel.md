# Vercel 部署 SOP

本文档描述如何将 arxiv-radar 部署到 Vercel（Hobby 计划）。

---

## 前置条件

- Node.js ≥ 18
- [Vercel CLI](https://vercel.com/docs/cli) 已安装并登录（`npm i -g vercel && vercel login`）
- 本地已有可用的 `.env` 配置文件

## 一、创建 Neon 数据库

1. 打开 https://vercel.com → 项目 → **Storage** → **Create Database** → 选 **Neon Postgres**
2. 选择区域（推荐 `ap-southeast-1`），创建并绑定项目
3. 进入 https://console.neon.tech → 你的项目 → **Connection Details**
4. 分别复制：
   - **Connection string**（pooled，含 `-pooler`）— 用于应用运行时（`DATABASE_URL`）
   - **Direct connection string**（不含 `-pooler`）— 用于迁移和数据导入

> ⚠️ Pooler 连接不支持 DDL（建表）操作，迁移必须使用直连地址。

## 二、运行数据库迁移

```bash
DATABASE_URL="<直连地址>" npm run db:migrate
```

## 三、（可选）同步本地数据到远程

如需将本地 PostgreSQL 的数据导入远程 Neon：

```bash
# 使用一键脚本
scripts/deploy-vercel.sh --sync-db
```

或手动操作：

```bash
LOCAL_DB="postgresql://user@localhost:5432/arxiv_radar"
REMOTE_DB="<Neon 直连地址>"

# 按 FK 依赖顺序逐表导入
TABLES="schema_migrations papers users user_settings user_analysis_runs user_analysis_failures user_papers user_favorites user_paper_tags user_conductor_task_bindings"

psql "$REMOTE_DB" -c "TRUNCATE papers, users, schema_migrations CASCADE;"

for t in $TABLES; do
  pg_dump "$LOCAL_DB" --data-only --no-owner --no-privileges -t "$t" | \
    grep -v "^SET\|^SELECT\|^--\|^$\|ALTER TABLE.*DISABLE\|ALTER TABLE.*ENABLE" | \
    psql "$REMOTE_DB"
done
```

## 四、配置环境变量

必须在 Vercel 中配置以下环境变量（Production 环境）：

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `DATABASE_URL` | ✅ | Neon **Pooler** 连接串 |
| `OPENAI_URL` | ✅ | OpenAI 兼容 API 地址 |
| `OPENAI_API_KEY` | ✅ | API 密钥 |
| `OPENAI_MODEL` | ✅ | 模型名（如 `gpt-4o-mini`） |
| `CONDUCTOR_BASE_URL` | ✅ | Conductor 服务地址 |
| `CONDUCTOR_SSO_CLIENT_ID` | ✅ | SSO 客户端 ID |
| `CONDUCTOR_SSO_CLIENT_SECRET` | ✅ | SSO 客户端密钥 |
| `ARXIV_AUTH_SECRET` | ✅ | 会话 Cookie 加密密钥 |
| `APP_URL` | ✅ | 生产域名，如 `https://arxiv-radar.vercel.app` |
| `APP_TIME_ZONE` | 建议 | 时区，如 `Asia/Shanghai` |
| `CONDUCTOR_DAEMON_HOST` | 建议 | Conductor daemon 主机 |
| `CONDUCTOR_WORKSPACE_PATH` | 建议 | daemon 上的工作区路径 |
| `CONDUCTOR_APP_NAME` | 建议 | 应用名称 |
| `CONDUCTOR_TOKEN` | 可选 | 服务端回退 token |
| `CONDUCTOR_BACKEND_TYPE` | 可选 | 后端 CLI 类型 |
| `CRON_SECRET` | 可选 | Cron 触发验证密钥 |
| `ARXIV_LIMIT` | 可选 | 抓取论文数量上限（默认 100） |
| `OPENAI_CONCURRENCY` | 可选 | AI 分析并发数（默认 3） |
| `MAX_STORED_PAPERS` | 可选 | 最大存储论文数（默认 800） |

可通过一键脚本从本地 `.env` 批量同步，或在 Vercel 面板手动配置。

## 五、部署

```bash
vercel --prod --yes
```

## 六、Conductor SSO 回调注册

在 Conductor 端的 `CONDUCTOR_SSO_CLIENTS_JSON` 中，为 `arxiv-radar` 客户端添加回调 URL：

```
https://<你的域名>/api/auth/callback
```

## 七、验证

```bash
# 首页
curl -s -o /dev/null -w "%{http_code}" https://arxiv-radar.vercel.app

# SSO 登录跳转
curl -s -o /dev/null -w "%{http_code}" https://arxiv-radar.vercel.app/api/auth/login

# Cron 定时任务
curl -s https://arxiv-radar.vercel.app/api/cron/arxiv
```

## 注意事项

- Vercel Hobby 计划仅支持每天一次的 Cron Job（当前配置：`0 2 * * *`，每天 UTC 02:00）
- `pnpm-lock.yaml` 与 Vercel 兼容性问题：`vercel.json` 中已配置 `"installCommand": "npm install"`
- Neon 免费额度：0.5 GB 存储，正常使用足够
