#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");

const TAG_CONFIGS = {
  slam: {
    label: "SLAM",
    resultKey: "slam",
    prompt: [
      "你是机器人论文读者。只判断一件事：这篇论文是否属于 SLAM 标签。",
      "返回 JSON 对象，字段为 { slam: boolean, evidence: string, confidence: number }。",
      "slam 只在论文明确使用、提出、改进或评估 SLAM/Simultaneous Localization and Mapping/同时定位与建图（含 visual SLAM、LiDAR SLAM、visual-inertial SLAM/VIO、dense SLAM、neural SLAM、Gaussian/NeRF SLAM、semantic SLAM 等）来做机器人/移动平台的定位、建图、姿态估计或导航时为 true。",
      "只做纯里程计、纯定位（无建图）、纯重建（无在线定位）、SLAM 仅作背景或相关工作的不算。",
      "evidence 必须引用 title 或 abstract 里的具体片段；confidence 是 0 到 1。",
      "没有充分证据就 slam=false，不要凭关键词猜（例如只提到 mapping 或 localization 而无 SLAM 框架不算）。",
    ].join("\n"),
  },
  umi: {
    label: "UMI",
    resultKey: "umi",
    prompt: [
      "你是机器人论文读者。只判断一件事：这篇论文是否属于 UMI 标签。",
      "返回 JSON 对象，字段为 { umi: boolean, evidence: string, confidence: number }。",
      "umi 只在论文明确使用、复用、扩展或对比 UMI/Universal Manipulation Interface（Cheng Chi 等人提出的手持式 GoPro+夹爪便携数据采集装置，及其在野/in-the-wild 数据采集 + diffusion policy 训练流程，以及 Bimanual UMI / Mobile UMI / Fast-UMI / UMI-on-Legs 等明确派生工作）来采集人类示范、训练机器人策略、做操作学习或评测时为 true。",
      "只引用 UMI 论文作为相关工作、或在没有用到该 handheld gripper 数据采集装置/对应训练 pipeline 的普通 imitation/diffusion policy/示教学习论文不算。",
      "evidence 必须引用 title 或 abstract 里的具体片段；confidence 是 0 到 1。",
      "没有充分证据就 umi=false，不要凭关键词猜。",
    ].join("\n"),
  },
};

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

function compact(value, max) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, max)}...`;
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open >= 0 && close > open) return text.slice(open, close + 1);
  return text.trim();
}

async function loadCandidates(pool, userId, tag) {
  const result = await pool.query(
    `
      SELECT
        p.id,
        p.title,
        p.authors,
        p.categories,
        p.abstract,
        COALESCE(jsonb_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '[]'::jsonb) AS tags
      FROM user_papers up
      INNER JOIN papers p ON p.id = up.paper_id
      LEFT JOIN user_paper_tags t
        ON t.user_id = up.user_id
       AND t.paper_id = up.paper_id
      WHERE up.user_id = $1
        AND up.removed = false
      GROUP BY p.id
      HAVING NOT (COALESCE(jsonb_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '[]'::jsonb) ? $2)
      ORDER BY max(up.updated_at) DESC
    `,
    [userId, tag],
  );
  return result.rows;
}

async function judgePaper(config, paper, openAiConfig) {
  const userPayload = {
    title: paper.title,
    authors: paper.authors,
    categories: paper.categories,
    abstract: compact(paper.abstract, 3800),
  };
  const response = await fetch(`${openAiConfig.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: openAiConfig.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: config.prompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
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
    matched: Boolean(result[config.resultKey]),
    evidence: typeof result.evidence === "string" ? result.evidence : "",
    confidence: typeof result.confidence === "number" ? result.confidence : null,
  };
}

async function applyTag(pool, userId, paperId, tag, judgement) {
  await pool.query(
    `
      INSERT INTO user_paper_tags(user_id, paper_id, tag, evidence, confidence, source)
      VALUES ($1, $2, $3, $4, $5, 'abstract')
      ON CONFLICT (user_id, paper_id, tag) DO UPDATE SET
        evidence = EXCLUDED.evidence,
        confidence = EXCLUDED.confidence,
        source = EXCLUDED.source,
        updated_at = now()
    `,
    [userId, paperId, tag, judgement.evidence, judgement.confidence],
  );
  await pool.query(
    `
      UPDATE user_papers
      SET updated_at = now()
      WHERE user_id = $1 AND paper_id = $2
    `,
    [userId, paperId],
  );
}

export async function runBackfillTag(tag) {
  loadEnvFromFile(resolve(projectRoot, ".env"));

  const config = TAG_CONFIGS[tag];
  if (!config) {
    throw new Error(`Unknown tag ${tag}. Expected one of: ${Object.keys(TAG_CONFIGS).join(", ")}`);
  }

  const databaseUrl = process.env.DATABASE_URL;
  const userId = process.env.ARXIV_USER_ID;
  const openAiConfig = {
    baseUrl: ((process.env.OPENAI_URL || "https://api.openai.com/v1").trim()).replace(/\/+$/, ""),
    apiKey: process.env.OPENAI_API_KEY?.trim(),
    model: (process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
  };
  const concurrency = Math.max(1, Number(process.env.BACKFILL_CONCURRENCY || 3));
  const dryRun = process.env.BACKFILL_DRY_RUN === "1";

  if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
  if (!userId) throw new Error("ARXIV_USER_ID is required for user-scoped backfill");
  if (!openAiConfig.apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const candidates = await loadCandidates(pool, userId, tag);
    console.log(
      `user ${userId}: ${candidates.length} visible candidate(s) without ${tag}.`,
    );
    if (dryRun) {
      console.log("BACKFILL_DRY_RUN=1, will call LLM but skip DB writes.");
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
          const judgement = await judgePaper(config, paper, openAiConfig);
          results.evaluated += 1;

          if (judgement.matched) {
            results.positives.push({
              id: paper.id,
              title: paper.title,
              evidence: judgement.evidence,
              confidence: judgement.confidence,
            });
            if (!dryRun) {
              await applyTag(pool, userId, paper.id, tag, judgement);
            }
            console.log(
              `[worker ${id}] (${index + 1}/${candidates.length}) ${config.label}=true  ${paper.id}  ${paper.title.slice(0, 80)}`,
            );
          } else {
            console.log(
              `[worker ${id}] (${index + 1}/${candidates.length}) ${config.label}=false ${paper.id}`,
            );
          }
        } catch (error) {
          results.errors.push({
            id: paper?.id,
            title: paper?.title,
            error: error.message,
          });
          console.error(
            `[worker ${id}] (${index + 1}/${candidates.length}) ERROR ${paper?.id}: ${error.message}`,
          );
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, candidates.length) }, (_, index) =>
        worker(index + 1),
      ),
    );
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runBackfillTag(process.argv[2] || "")
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
