#!/usr/bin/env node
// One-off backfill: ask the LLM only "is this paper Sim?" for every visible
// paper that doesn't already have the sim tag, and PATCH the existing
// /api/papers/:id/tags endpoint to add it.
//
// Reads the local state file directly to enumerate papers; the actual tag
// write goes through the running web app (so the app's mutation logic stays
// the single source of truth).
//
// Usage:
//   APP_URL=http://localhost:3000 node scripts/backfill-sim-tag.mjs
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

const OPENAI_URL = ((process.env.OPENAI_URL || "https://api.openai.com/v1").trim()).replace(/\/+$/, "");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_MODEL = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
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
  return !tags.includes("sim");
});

console.log(
  `state: ${allPapers.length} papers total; ${candidates.length} candidates without sim (skipping removed/already-tagged).`,
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
  "你是机器人论文读者。只判断一件事：这篇论文是否属于 Sim（仿真）标签。",
  "返回 JSON 对象，字段为 { sim: boolean, evidence: string, confidence: number }。",
  "sim 只在论文显著依赖物理/机器人仿真器或合成环境来做训练、数据生成、策略学习、sim-to-real 迁移、大规模评测或核心实验时为 true。",
  "包括 MuJoCo、Isaac Gym/Sim/Lab、Habitat、Genesis、Gazebo、PyBullet、RoboCasa、ManiSkill、RoboSuite、CARLA、AirSim、LeRobot sim、SAPIEN、ThreeDWorld 等已知仿真器，以及论文自建/扩展的仿真环境。",
  "只做纯几何/3D 渲染可视化、只用真机实验、仿真仅作相关工作或背景提及、单一定性 demo 而无仿真训练或评测的不算。",
  "evidence 必须引用 title 或 abstract 里的具体片段；confidence 是 0 到 1。",
  "没有充分证据就 sim=false；只是泛泛提到 simulation/simulated 而无具体仿真器或仿真实验细节也不算。",
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
    sim: Boolean(result.sim),
    evidence: typeof result.evidence === "string" ? result.evidence : "",
    confidence: typeof result.confidence === "number" ? result.confidence : undefined,
  };
}

async function applyTag(paper) {
  const nextTags = Array.from(new Set([...(paper.tags || []), "sim"]));
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

      if (judgement.sim) {
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
          `[worker ${id}] (${index + 1}/${candidates.length}) SIM=true  ${paper.id}  ${paper.title.slice(0, 80)}`,
        );
        if (judgement.evidence) {
          console.log(`    evidence: ${judgement.evidence.slice(0, 200)}`);
        }
      } else {
        console.log(
          `[worker ${id}] (${index + 1}/${candidates.length}) SIM=false ${paper.id}`,
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
  console.log("\nSim-positive papers:");
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
