<div align="center">

# arxiv-radar

**Your daily AI-powered radar for robotics research.**

Auto-fetches new arXiv papers every day, analyzes them with an AI, auto-tags the topics you care about, and lets you chat with any paper. 

And most important, it is FREE.

[**Website → arxiv-radar.vercel.app**](https://arxiv-radar.vercel.app/)

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Deploy on Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com/)

</div>

---

## Features

- **Daily auto-fetch** — pulls the latest cs.RO papers on a per-user schedule.
- **LLM analysis** — one-sentence summary, hypothesis, method, problem, and conclusion for every paper.
- **Smart auto-tagging** — labels papers across topics like VLA, world models, egocentric, teleop, SLAM, UMI, sim, SO-101 and VR, with evidence quotes.
- **Chat with papers** — ask questions about any paper, backed by per-user Conductor chat tasks.
- **Personal workspace** — favorites, hide, custom tags, and detected GitHub links, all scoped to your account.
- **PWA** — installable, works great on mobile.
- **Multi-user** — Conductor SSO login; every user gets isolated papers, tags, settings, and schedules in Postgres.

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure — copy and fill in your keys
cp .env.example .env.local

# 3. Run migrations
npm run db:migrate

# 4. Start
npm run dev   # → http://localhost:3000
```

Sign in via Conductor SSO, then open the gear menu to set your fetch URL, daily schedule, and AI backend.

## Configuration

Set these in `.env.local` (see `.env.example` for the full list):

| Variable | Description |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `OPENAI_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | LLM endpoint used for analysis |
| `APP_URL` | This app's public URL |
| `CONDUCTOR_BASE_URL` | Conductor SSO base URL |
| `CONDUCTOR_SSO_CLIENT_ID` / `CONDUCTOR_SSO_CLIENT_SECRET` | Conductor SSO client credentials |
| `ARXIV_AUTH_SECRET` | Secret for encrypting the session cookie |
| `CRON_SECRET` | Bearer token guarding the cron endpoint (optional) |

> Register an `arxiv-radar` client on Conductor with `${APP_URL}/api/auth/callback` in its `redirect_uris`.

## Scheduled Fetching

The app exposes a cron endpoint that runs each user's analysis at their configured time:

```bash
GET  /api/cron/arxiv                 # auto run for all users (add Authorization: Bearer $CRON_SECRET)
POST /api/cron/arxiv?manual=1        # manual run for the logged-in user
npm run cron                         # trigger the auto cron once locally
npm run worker                       # local worker, polls every 5 min
```

On Vercel, `vercel.json` schedules `*/5 * * * *`; actual run times come from each user's settings and `APP_TIME_ZONE`.

## Deploy to Vercel

```bash
npm run lint
npm run build
vercel --prod
```

Set `DATABASE_URL`, the `OPENAI_*` and Conductor SSO variables, and `CRON_SECRET` in your Vercel project, then run `npm run db:migrate`.

## Tech Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS v4 · PostgreSQL · Conductor SSO · OpenAI-compatible LLM
