# arxiv-radar

每天分析 `https://arxiv.org/list/cs.RO/recent?skip=0&show=100` 的前 100 篇机器人论文，按 arXiv ID 跳过已经处理过的文章，并为每篇论文保存：

- 一句话中文总结：假设、方法、问题、结论
- `egocentric` 标签
- `自建采集硬件` 标签
- arXiv/PDF 链接、作者、摘要原文和任务记录

## 环境变量

复制 `.env.example` 为 `.env.local`，填入真实 key：

```bash
OPENAI_URL=https://neolink.com/api/v1
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
```

可选变量：

```bash
APP_URL=http://localhost:3000
APP_TIME_ZONE=Asia/Shanghai
ARXIV_DAILY_URL=https://arxiv.org/list/cs.RO/recent?skip=0&show=100
ARXIV_AUTO_FETCH_ENABLED=1
ARXIV_LIMIT=100
ARXIV_RUN_HOUR=2
ARXIV_RUN_MINUTE=0
OPENAI_CONCURRENCY=3
ARXIV_FULL_TEXT_MAX_CHARS=50000
ARXIV_FULL_TEXT_TIMEOUT_MS=10000
CRON_SECRET=...
ARXIV_DATA_FILE_NAME=arxiv-state.json
MAX_STORED_PAPERS=800
```

部署到 Vercel 时建议启用 Vercel Blob 持久化：

```bash
ARXIV_STORE_BACKEND=blob
ARXIV_BLOB_STATE_PATH=arxiv/arxiv-state.json
ARXIV_BLOB_ACCESS=private
```

在 Vercel Dashboard 给项目创建并连接一个 private Blob store 后，`BLOB_READ_WRITE_TOKEN` 会自动注入到项目环境变量；本地仍可保持 `ARXIV_STORE_BACKEND=file` 使用 `data/arxiv-state.json`。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，点击“立即分析”可手动触发。

顶栏齿轮按钮可打开配置 popup，保存后立即写入当前应用状态：

- arxiv daily 拉取链接
- 每天自动拉取时间和自动拉取开关
- Conductor 地址、key、daemon、workspace、app name、AI backend

## 定时任务

应用提供 cron API：

```bash
POST /api/cron/arxiv
GET /api/cron/arxiv
```

如果配置了 `CRON_SECRET`，请求需要带：

```bash
Authorization: Bearer $CRON_SECRET
```

生产环境建议配置 `CRON_SECRET`；Vercel Cron 会自动带上该 header。启用后页面里的“立即分析”按钮会禁用，手动触发可在 Vercel Cron 面板执行，或请求 `/api/cron/arxiv?secret=$CRON_SECRET`。

分析新论文时会优先抓取 `https://arxiv.org/html/{arxivId}` 的正文，交给 LLM 基于标题、摘要和正文语义判断 `egocentric` / `自建采集硬件` 标签；代码不再使用关键词规则兜底。正文不可用时会记录状态，并降级为 LLM 基于可用元数据判断。

本地一次性触发：

```bash
npm run cron
```

本地常驻 worker 每 5 分钟请求一次 cron API，由服务端按配置 popup 中保存的开关和时间判断是否执行：

```bash
npm run worker
```

Vercel 部署时，`vercel.json` 已配置 `*/5 * * * *`。实际执行时间由配置 popup 中保存的本地时间决定，时区来自 `APP_TIME_ZONE`。

## 数据存储

本地默认写入 `data/arxiv-state.json`。该文件包含已经处理过的 arXiv ID、分析结果和最近任务记录，并已在 `.gitignore` 中忽略。

Vercel Functions 的文件系统不适合作为持久数据库，因此生产环境应使用 `ARXIV_STORE_BACKEND=blob`。当前数据量小、写入频率低（每日一次 cron 加手动触发），单个 JSON 状态文件放在 Vercel Blob 里最简单；如果后续需要复杂筛选、多人写入、全文检索或更强事务一致性，再迁移到 Marketplace Postgres（Neon/Supabase 等）。

## 部署到 Vercel

```bash
npm run lint
npm run build
vercel
vercel --prod
```

部署前在 Vercel 项目环境变量中配置 `OPENAI_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`CRON_SECRET`，并连接 private Blob store 后设置 `ARXIV_STORE_BACKEND=blob`。
