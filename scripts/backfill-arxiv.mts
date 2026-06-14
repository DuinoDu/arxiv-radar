// One-off backfill: re-run the daily arXiv pipeline for a single user across an
// archive month, paginating the listing so every missing announcement day gets
// processed. force=false, so the pipeline's own dedup analyzes only papers the
// user does not already have.
//
// Usage:
//   node_modules/.bin/tsx scripts/backfill-arxiv.mts \
//     --user <userId> --month 2026-06 [--category cs.RO] [--start-skip 0] [--max-pages 12]

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnvFromFile(filePath: string) {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

// Must run BEFORE importing the app modules: the db layer reads DATABASE_URL at
// import time to pick its backend.
loadEnvFromFile(path.join(rootDir, ".env.local"));
loadEnvFromFile(path.join(rootDir, ".env"));

function arg(flag: string, fallback?: string) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const userId = arg("--user");
const month = arg("--month"); // e.g. 2026-06
const category = arg("--category", "cs.RO")!;
const startSkip = Number(arg("--start-skip", "0"));
const maxPages = Number(arg("--max-pages", "12"));
const PAGE = 100;

if (!userId || !month) {
  console.error("Missing required --user and --month");
  process.exit(1);
}

const { runArxivAnalysis, AnalysisAlreadyRunningError } = await import("@/lib/arxiv/job");

console.log(
  `Backfill user=${userId} category=${category} month=${month} startSkip=${startSkip} maxPages=${maxPages}`,
);
console.log(`DB backend: ${process.env.DATABASE_URL}`);

let totalFetched = 0;
let totalAnalyzed = 0;
let totalSkipped = 0;
let totalFailed = 0;

for (let page = 0; page < maxPages; page += 1) {
  const skip = startSkip + page * PAGE;
  const sourceUrl = `https://arxiv.org/list/${category}/${month}?skip=${skip}&show=${PAGE}`;
  process.stdout.write(`\n[page ${page} skip=${skip}] ${sourceUrl}\n`);

  try {
    const { run } = await runArxivAnalysis(userId, {
      sourceUrl,
      limit: PAGE,
      force: false,
      trigger: "manual",
    });
    totalFetched += run.fetchedCount;
    totalAnalyzed += run.analyzedCount;
    totalSkipped += run.skippedAlreadyProcessedCount;
    totalFailed += run.failedCount;
    console.log(
      `  -> status=${run.status} fetched=${run.fetchedCount} analyzed=${run.analyzedCount} skipped=${run.skippedAlreadyProcessedCount} failed=${run.failedCount}`,
    );

    if (run.fetchedCount < PAGE) {
      console.log(`  (last page reached: fetched ${run.fetchedCount} < ${PAGE})`);
      break;
    }
  } catch (error) {
    if (error instanceof AnalysisAlreadyRunningError) {
      console.error("  another run is active; aborting backfill");
      process.exit(1);
    }
    console.error(`  page failed: ${(error as Error).message}`);
    // Continue to next page rather than abandoning the whole backfill.
  }
}

console.log(
  `\nDONE. fetched=${totalFetched} analyzed=${totalAnalyzed} skipped=${totalSkipped} failed=${totalFailed}`,
);
process.exit(0);
