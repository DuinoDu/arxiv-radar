#!/usr/bin/env node
// One-off backfill: ask the LLM only "is this paper SLAM?" for every visible
// paper that doesn't already have the slam tag, and PATCH the existing
// /api/papers/:id/tags endpoint to add it.
//
// Reads the local state file directly to enumerate papers; the actual tag
// write goes through the running web app (so the app's mutation logic stays
// the single source of truth).
//
// Usage:
//   APP_URL=http://localhost:3000 node scripts/backfill-slam-tag.mjs
// Env:
//   OPENAI_API_KEY        required
//   OPENAI_URL            optional, defaults to https://api.openai.com/v1
//   OPENAI_MODEL          optional, defaults to gpt-4o-mini
//   APP_URL               optional, defaults to http://localhost:3000
//   ARXIV_DATA_FILE_NAME  optional, defaults to arxiv-state.json
//   BACKFILL_CONCURRENCY  optional, defaults to 3
//   BACKFILL_DRY_RUN      set to 1 to skip PATCH calls (preview only)

import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

// Lightweight .env loader so the script behaves like `npm run cron` without
// dragging in a dotenv dependency.
function loadEnvFromFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
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

loadEnvFromFile(resolve(projectRoot, ".env"));

const OPENAI_URL = (process.env.OPENAI_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const APP_URL = process.env.APP_URL || "http://localhost:3000";
const DATA_FILE = process.env.ARXIV_DATA_FILE_NAME || "arxiv-state.json";
const CONCURRENCY = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY || 3));
const DRY_RUN = process.env.BACKFILL_DRY_RUN === "1";

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not configured");
  process.exit(1);
}

const stateFile = resolve(projectRoot, "data", DATA_FILE);

const state = JSON.parse(await readFile(stateFile, "utf8"));
const allPapers = Array.isArray(state.papers) ? state.papers : [];

const candidates = allPapers.filter((paper) => {
  if (paper.removed) return false;
  const tags = Array.isArray(paper.tags) ? paper.tags : [];
  return !tags.includes("slam");
});

console.log(
  `state: ${allPapers.length} papers total; ${candidates.length} candidates without slam (skipping removed/already-tagged).`,
);

if (candidates.length === 0) {
  console.log("nothing to do.");
  process.exit(0);
}

if (DRY_RUN) {
  console.log("BACKFILL_DRY_RUN=1, will call LLM but skip PATCH.");
}

function compact(value, max) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

const SYSTEM_PROMPT = [
  "你是机器人论文读者。只判断一件事：这篇论文是否属于 SLAM 标签。",
  "返回 JSON 对象，字段为 { slam: boolean, evidence: string, confidence: number }。",
  "slam 只在论文明确使用、提出、改进或评估 SLAM/Simultaneous Localization and Mapping/同时定位与建图（含 visual SLAM、LiDAR SLAM、visual-inertial SLAM/VIO、dense SLAM、neural SLAM、Gaussian/NeRF SLAM、semantic SLAM 等）来做机器人/移动平台的定位、建图、姿态估计或导航时为 true。",
  "只做纯里程计、纯定位（无建图）、纯重建（无在线定位）、SLAM 仅作背景或相关工作的不算。",
  "evidence 必须引用 title 或 abstract 里的具体片段；confidence 是 0 到 1。",
  "没有充分证据就 slam=false，不要凭关键词猜（例如只提到 mapping 或 localization 而无 SLAM 框架不算）。",
].join("\n");

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open >= 0 && close > open) return text.slice(open, close + 1);
  return text.trim();
}

async function judge(paper) {
  const userPayload = {
    title: paper.title,
    authors: paper.authors,
    categories: paper.categories,
    abstract: compact(paper.abstract, 3800),
  };

  const body = {
    model: OPENAI_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  };

  const response = await fetch(`${OPENAI_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI ${response.status}: ${text.slice(0, 400)}`);
  }

  const parsed = JSON.parse(text);
  const content = parsed?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(parsed?.error?.message || "no content");
  }

  const result = JSON.parse(extractJson(content));
  return {
    slam: Boolean(result.slam),
    evidence: typeof result.evidence === "string" ? result.evidence : "",
    confidence: typeof result.confidence === "number" ? result.confidence : undefined,
  };
}

async function applyTag(paper) {
  const nextTags = Array.from(new Set([...(paper.tags || []), "slam"]));
  const url = `${APP_URL.replace(/\/+$/, "")}/api/papers/${encodeURIComponent(paper.id)}/tags`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: nextTags }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PATCH ${url} -> ${response.status}: ${body.slice(0, 300)}`);
  }
}

const results = {
  positives: [],
  errors: [],
  total: candidates.length,
  evaluated: 0,
};

let cursor = 0;

async function worker(id) {
  while (cursor < candidates.length) {
    const index = cursor;
    cursor += 1;
    const paper = candidates[index];

    try {
      const judgement = await judge(paper);
      results.evaluated += 1;

      if (judgement.slam) {
        results.positives.push({
          id: paper.id,
          title: paper.title,
          evidence: judgement.evidence,
          confidence: judgement.confidence,
        });

        if (!DRY_RUN) {
          await applyTag(paper);
        }

        console.log(
          `[worker ${id}] (${index + 1}/${candidates.length}) SLAM=true  ${paper.id}  ${paper.title.slice(0, 80)}`,
        );
        if (judgement.evidence) {
          console.log(`    evidence: ${judgement.evidence.slice(0, 200)}`);
        }
      } else {
        console.log(
          `[worker ${id}] (${index + 1}/${candidates.length}) SLAM=false ${paper.id}`,
        );
      }
    } catch (error) {
      results.errors.push({ id: paper.id, error: String(error?.message || error) });
      console.error(
        `[worker ${id}] (${index + 1}/${candidates.length}) ERROR     ${paper.id}: ${String(error?.message || error).slice(0, 300)}`,
      );
    }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, (_, i) => worker(i + 1)));

console.log("\n--- summary ---");
console.log(`evaluated: ${results.evaluated} / ${results.total}`);
console.log(`positives: ${results.positives.length}`);
console.log(`errors:    ${results.errors.length}`);
if (results.positives.length) {
  console.log("\nSLAM-positive papers:");
  for (const p of results.positives) {
    console.log(
      `  ${p.id}  conf=${p.confidence ?? "-"}  ${p.title.slice(0, 100)}\n    ${(p.evidence || "").slice(0, 200)}`,
    );
  }
}
if (results.errors.length) {
  console.log("\nerrors:");
  for (const e of results.errors) {
    console.log(`  ${e.id}: ${e.error}`);
  }
}
