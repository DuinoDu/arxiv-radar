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
ARXIV_LIMIT=100
OPENAI_CONCURRENCY=3
CRON_SECRET=...
ARXIV_DATA_FILE_NAME=arxiv-state.json
MAX_STORED_PAPERS=800
```

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:3000`，点击“立即分析”可手动触发。

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

本地一次性触发：

```bash
npm run cron
```

本地常驻 worker，每天 00:00 `APP_TIME_ZONE` 触发：

```bash
npm run worker
```

Vercel 部署时，`vercel.json` 已配置 `0 16 * * *`，对应北京时间每天 00:00。

## 数据存储

默认写入 `data/arxiv-state.json`。该文件包含已经处理过的 arXiv ID、分析结果和最近任务记录，并已在 `.gitignore` 中忽略。
