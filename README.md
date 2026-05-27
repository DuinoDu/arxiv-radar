# arxiv-radar

每天分析 `https://arxiv.org/list/cs.RO/recent?skip=0&show=100` 的机器人论文，并按 Conductor 登录用户保存：

- 论文列表、分析结果、已处理 arXiv ID、收藏和隐藏状态
- 用户自己的 tag 标注
- 用户自己的配置和自动拉取计划
- 用户自己的 Conductor paper chat task binding

未登录时主页只显示 Conductor 登录入口，不读取或展示具体 tag / paper card 信息。

## 环境变量

复制 `.env.example` 为 `.env.local`，填入真实 key：

```bash
OPENAI_URL=https://neolink.com/api/v1
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
DATABASE_URL=postgresql://user:password@localhost:5432/arxiv_radar
```

Conductor SSO 登录需要在 Conductor 侧注册 `arxiv-radar` client，并确保
`redirect_uris` 包含 `${APP_URL}/api/auth/callback`。arxiv-radar 侧配置：

```bash
APP_URL=http://localhost:3000
CONDUCTOR_BASE_URL=https://conductor-ai.top
CONDUCTOR_SSO_CLIENT_ID=arxiv-radar
CONDUCTOR_SSO_CLIENT_SECRET=...
ARXIV_AUTH_SECRET=...
```

`CONDUCTOR_SSO_CLIENT_SECRET` 必须与 Conductor 侧注册的 client secret 一致；
`ARXIV_AUTH_SECRET` 用于加密 arxiv-radar 自己的 HttpOnly session cookie。登录完成后，
聊天 BFF 会使用该用户换取的 Conductor token；每位用户的论文聊天 task 独立保存，
不会复用其他用户的任务。

创建 chat task 仍需配置共享的运行位置：

```bash
CONDUCTOR_DAEMON_HOST=...
CONDUCTOR_WORKSPACE_PATH=...
CONDUCTOR_APP_NAME=arxiv-radar
CONDUCTOR_BACKEND_TYPE=
```

常用可选变量：

```bash
APP_TIME_ZONE=Asia/Shanghai
ARXIV_DAILY_URL=https://arxiv.org/list/cs.RO/recent?skip=0&show=100
ARXIV_AUTO_FETCH_ENABLED=1
ARXIV_LIMIT=100
ARXIV_RUN_HOUR=2
ARXIV_RUN_MINUTE=0
ARXIV_WORKER_POLL_MS=300000
OPENAI_CONCURRENCY=3
CRON_SECRET=...
MAX_STORED_PAPERS=800
```

## 数据库

运行 migration：

```bash
npm install
npm run db:migrate
```

如果需要把旧的 `data/arxiv-state.json` 导入到某个 Conductor 用户下：

```bash
ARXIV_USER_ID=<conductor-user-id> npm run db:import-json
```

也可以显式指定文件：

```bash
npm run db:import-json -- --user-id <conductor-user-id> --state data/arxiv-state.json
```

运行时状态不再使用本地 JSON 或 Vercel Blob；所有配置、tag、paper list、收藏、运行记录和聊天 task binding 都按 `user_id` 存在 PostgreSQL。

## 本地运行

```bash
npm run dev
```

打开 `http://localhost:3000`，先通过 Conductor 登录。登录后顶栏齿轮按钮可打开配置 popup，保存当前用户的：

- arxiv daily 拉取链接
- 每天自动拉取时间和自动拉取开关
- Conductor daemon、workspace、app name、AI backend

## 定时任务

应用提供 cron API：

```bash
GET /api/cron/arxiv
POST /api/cron/arxiv?manual=1
```

自动 cron 使用 `GET /api/cron/arxiv`，会遍历所有开启自动拉取的用户，并按每个用户自己的时间设置判断是否执行。如果配置了 `CRON_SECRET`，自动请求需要带：

```bash
Authorization: Bearer $CRON_SECRET
```

手动触发需要当前浏览器已登录，执行当前用户的分析。

本地一次性触发自动 cron：

```bash
npm run cron
```

本地常驻 worker 每 5 分钟请求一次自动 cron API：

```bash
npm run worker
```

Vercel 部署时，`vercel.json` 已配置 `*/5 * * * *`。实际执行时间由每个用户的配置决定，时区来自 `APP_TIME_ZONE`。

## 部署到 Vercel

```bash
npm run lint
npm run build
vercel
vercel --prod
```

部署前在 Vercel 项目环境变量中配置 `DATABASE_URL`、`OPENAI_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`、`CRON_SECRET` 和 Conductor SSO 相关变量，然后执行 `npm run db:migrate`。
