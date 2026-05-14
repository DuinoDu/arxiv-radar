# Deploy Agent SOP: Vercel Deployment

## Mission

Ship the app to Vercel with a reproducible command path, verified runtime configuration, and a persistence plan that survives serverless restarts.

The deploy agent owns the deployment outcome, not just the CLI command. Do not call the deploy done until the production alias responds and the critical routes have been checked.

## Operating Rules

- Treat production deploys as state-changing operations. Confirm the target project, scope, branch/worktree, and domain before deploying.
- Do not print secrets. Add sensitive values through Vercel Dashboard, `vercel env add --sensitive`, or stdin.
- Keep unrelated local changes intact. If the worktree is dirty, identify what will be deployed before running `vercel --prod`.
- Prefer a preview deploy first unless the user explicitly asks for a production redeploy.
- For apps that write data, verify the storage backend before production. Vercel Functions do not provide durable local file storage.

## Inputs

Collect these before deployment:

- Vercel scope/team, for example `--scope <team-or-user>`.
- Vercel project name and production domain.
- Required runtime env vars.
- Persistent storage choice.
- Cron schedule and any required `CRON_SECRET`.
- Expected smoke-test URLs.

For this app, production should include:

```bash
OPENAI_URL=...
OPENAI_API_KEY=...
OPENAI_MODEL=...
APP_URL=https://<production-domain>
APP_TIME_ZONE=Asia/Shanghai
ARXIV_LIMIT=100
OPENAI_CONCURRENCY=3
CRON_SECRET=...
ARXIV_STORE_BACKEND=blob
ARXIV_BLOB_STATE_PATH=arxiv/arxiv-state.json
ARXIV_BLOB_ACCESS=private
BLOB_READ_WRITE_TOKEN=...
```

## Preflight

Run these checks from the repository root:

```bash
git status --short --branch
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

- Build must pass locally.
- The Vercel project must be the intended project.
- Required production env vars must exist.
- Any cron path in `vercel.json` must match a deployed route.

## Storage Decision

Use Vercel Blob for this app unless the requirements change.

Reasoning:

- The app stores a small JSON state file.
- Writes are low frequency: scheduled cron plus occasional manual/admin trigger.
- Blob is simpler than a relational database and works cleanly in Vercel Functions.

Create or connect a private Blob store:

```bash
vercel blob create-store <store-name> --access private --region iad1 --scope <scope>
```

When prompted, link it to the project and select the required environments. Vercel injects `BLOB_READ_WRITE_TOKEN` after the store is linked.

Move to Postgres/Neon/Supabase when the app needs relational querying, multi-user writes, complex filtering, full-text search, or stronger transaction boundaries.

## Environment Setup

List current env vars:

```bash
vercel env ls --scope <scope>
```

Add non-sensitive values:

```bash
vercel env add ARXIV_STORE_BACKEND production --value blob --yes --force --scope <scope>
vercel env add ARXIV_BLOB_STATE_PATH production --value arxiv/arxiv-state.json --yes --force --scope <scope>
vercel env add ARXIV_BLOB_ACCESS production --value private --yes --force --scope <scope>
```

Add sensitive values without echoing them into logs:

```bash
vercel env add OPENAI_API_KEY production --sensitive --scope <scope>
vercel env add CRON_SECRET production --sensitive --scope <scope>
```

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
curl -sS https://<production-domain> | rg "<expected-page-marker>"
curl -sS -o /tmp/cron.json -w "%{http_code}\n" https://<production-domain>/api/cron/arxiv
```

Expected results for this app:

- `/` returns `200`.
- Page contains `arxiv-radar`.
- `/api/cron/arxiv` returns `401` without `CRON_SECRET` in production.
- With Vercel Cron, `CRON_SECRET` is sent as an `Authorization` header automatically.

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
- Smoke-test results.
- Any unresolved risk, for example missing preview envs or unverified cron execution.

Useful references:

- Vercel CLI deploy: https://vercel.com/docs/cli/deploy
- Vercel Blob SDK: https://vercel.com/docs/storage/vercel-blob/using-blob-sdk
- Vercel Blob CLI: https://vercel.com/docs/cli/blob
- Vercel Cron Jobs: https://vercel.com/docs/cron-jobs/manage-cron-jobs
