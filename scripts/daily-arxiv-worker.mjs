const baseUrl = process.env.APP_URL || "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET;
const pollMs = Number(process.env.ARXIV_WORKER_POLL_MS || 60 * 60 * 1000);

async function trigger() {
  const url = new URL("/api/cron/arxiv", baseUrl);
  const response = await fetch(url, {
    method: "GET",
    headers: cronSecret
      ? {
          Authorization: `Bearer ${cronSecret}`,
        }
      : undefined,
  });
  const body = await response.text();
  console.log(`[${new Date().toISOString()}] ${response.status} ${body}`);
}

async function loop() {
  while (true) {
    await trigger();
    await new Promise((resolve) => setTimeout(resolve, Math.max(60_000, pollMs)));
  }
}

loop().catch((error) => {
  console.error(error);
  process.exit(1);
});
