const timeZone = process.env.APP_TIME_ZONE || "Asia/Shanghai";
const runAtHour = Number(process.env.ARXIV_RUN_HOUR || 0);
const runAtMinute = Number(process.env.ARXIV_RUN_MINUTE || 0);
const baseUrl = process.env.APP_URL || "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET;

function partsFor(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function offsetMinutesFor(date) {
  const parts = partsFor(date);
  const utcForWallTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return Math.round((utcForWallTime - date.getTime()) / 60000);
}

function nextRunDate() {
  const now = new Date();
  const local = partsFor(now);
  const targetUtcGuess = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    runAtHour,
    runAtMinute,
    0,
  );
  let target = new Date(targetUtcGuess - offsetMinutesFor(now) * 60000);

  if (target <= now) {
    target = new Date(target.getTime() + 24 * 60 * 60 * 1000);
  }

  return target;
}

async function trigger() {
  const url = new URL("/api/cron/arxiv", baseUrl);
  const response = await fetch(url, {
    method: "POST",
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
    const target = nextRunDate();
    const delay = Math.max(1000, target.getTime() - Date.now());
    console.log(`[${new Date().toISOString()}] next run: ${target.toISOString()} (${timeZone})`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    await trigger();
  }
}

loop().catch((error) => {
  console.error(error);
  process.exit(1);
});
