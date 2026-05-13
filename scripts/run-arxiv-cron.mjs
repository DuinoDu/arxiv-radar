const baseUrl = process.env.APP_URL || "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET;
const limit = process.env.ARXIV_LIMIT || "100";

const url = new URL("/api/cron/arxiv", baseUrl);
url.searchParams.set("limit", limit);

const response = await fetch(url, {
  method: "POST",
  headers: cronSecret
    ? {
        Authorization: `Bearer ${cronSecret}`,
      }
    : undefined,
});

const payload = await response.text();
console.log(payload);

if (!response.ok) {
  process.exitCode = 1;
}
