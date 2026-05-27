# Deploy Agent SOP: Vercel Deployment

## Mission

Ship the app to Vercel with a reproducible command path, verified runtime configuration, and durable PostgreSQL persistence.

The deploy agent owns the deployment outcome, not just the CLI command. Do not call the deploy done until the production alias responds and the critical routes have been checked.

## Operating Rules

- Treat production deploys as state-changing operations. Confirm the target project, scope, branch/worktree, and domain before deploying.
- Do not print secrets. Add sensitive values through Vercel Dashboard, `vercel env add --sensitive`, or stdin.
- Keep unrelated local changes intact. If the worktree is dirty, identify what will be deployed before running `vercel --prod`.
- Prefer a preview deploy first unless the user explicitly asks for a production redeploy.
- Verify `DATABASE_URL` and migrations before production. Vercel Functions do not provide durable local file storage.

## Inputs

Collect these before deployment:

- Vercel scope/team, for example `--scope <team-or-user>`.
- Vercel project name and production domain.
- Required runtime env vars.
- PostgreSQL provider and `DATABASE_URL`.
- Cron schedule and required `CRON_SECRET`.
- Expected smoke-test URLs.

For this app, production should include:

```bash
DATABASE_URL=...
OPENAI_URL=...
OPENAI_API_KEY=...
OPENAI_MODEL=...
APP_URL=https://<production-domain>
APP_TIME_ZONE=Asia/Shanghai
ARXIV_LIMIT=100
OPENAI_CONCURRENCY=3
CRON_SECRET=...
CONDUCTOR_BASE_URL=https://conductor-ai.top
CONDUCTOR_SSO_CLIENT_ID=arxiv-radar
CONDUCTOR_SSO_CLIENT_SECRET=...
ARXIV_AUTH_SECRET=...
CONDUCTOR_DAEMON_HOST=...
CONDUCTOR_WORKSPACE_PATH=...
CONDUCTOR_APP_NAME=arxiv-radar
CONDUCTOR_BACKEND_TYPE=
```

## Preflight

Run these checks from the repository root:

```bash
git status --short --branch
npm run db:migrate
npm run lint
npm run build
vercel whoami
vercel project inspect <project> --scope <scope>
vercel env ls --scope <scope>
```

Inspect deployment files:

```bash
cat vercel.json
cat next.config.ts
```

Gate:

- Migrations must pass against the production database or a staging database before deploy.
- Build must pass locally.
- The Vercel project must be the intended project.
- Required production env vars must exist.
- Any cron path in `vercel.json` must match a deployed route.

## Storage Decision

Use PostgreSQL for this app.

Reasoning:

- Config, tags, paper lists, favorites, runs, and Conductor task bindings are user-scoped.
- Multi-user writes need transaction boundaries and relational constraints.
- Cron must query per-user schedules and process users independently.

Run migrations whenever schema changes:

```bash
DATABASE_URL=... npm run db:migrate
```

If migrating legacy JSON state, import it under one explicit Conductor user:

```bash
DATABASE_URL=... ARXIV_USER_ID=<conductor-user-id> npm run db:import-json
```

## Environment Setup

List current env vars:

```bash
vercel env ls --scope <scope>
```

Add sensitive values without echoing them into logs:

```bash
vercel env add DATABASE_URL production --sensitive --scope <scope>
vercel env add OPENAI_API_KEY production --sensitive --scope <scope>
vercel env add CRON_SECRET production --sensitive --scope <scope>
vercel env add CONDUCTOR_SSO_CLIENT_SECRET production --sensitive --scope <scope>
vercel env add ARXIV_AUTH_SECRET production --sensitive --scope <scope>
```

Add non-sensitive values through the dashboard or `vercel env add` as appropriate.

If preview deployments need to run the app, repeat env setup for `preview`. If only production is required, production envs are sufficient.

## Deploy

Preview deploy:

```bash
vercel --yes --scope <scope>
```

Production deploy:

```bash
vercel --prod --yes --scope <scope>
```

If the directory is not linked yet, use:

```bash
vercel link --scope <scope>
```

Then rerun the deploy command.

## Verification

After deploy, inspect the deployment:

```bash
vercel inspect <deployment-url> --scope <scope>
```

Smoke test production:

```bash
curl -I https://<production-domain>
curl -sS https://<production-domain> | rg "Conductor"
curl -sS -o /tmp/cron.json -w "%{http_code}\n" https://<production-domain>/api/cron/arxiv
```

Expected results for this app:

- `/` returns `200` and shows the login gate when unauthenticated.
- Unauthenticated homepage does not expose paper titles, summaries, or tag lists.
- `/api/cron/arxiv` returns `401` without `CRON_SECRET` in production.
- Authenticated cron with `Authorization: Bearer $CRON_SECRET` returns per-user results.

Optional authenticated cron smoke test:

```bash
curl -sS \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://<production-domain>/api/cron/arxiv?limit=1"
```

Use a low `limit` for smoke tests to avoid unnecessary model spend.

## Rollback

If the new deployment is bad:

```bash
vercel ls --scope <scope>
vercel rollback <previous-production-url> --scope <scope>
```

If rollback is not available or not appropriate, redeploy the last known good commit/worktree:

```bash
git status --short --branch
npm run build
vercel --prod --yes --scope <scope>
```

## Final Report

Report only high-signal facts:

- Production URL.
- Deployment URL and status.
- Env/storage changes made.
- Migration status.
- Smoke-test results.
- Any unresolved risk, for example missing preview envs or unverified cron execution.

Useful references:

- Vercel CLI deploy: https://vercel.com/docs/cli/deploy
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs/manage-cron-jobs
