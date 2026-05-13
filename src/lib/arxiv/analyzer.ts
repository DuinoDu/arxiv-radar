import { z } from "zod";
import type { AnalyzedPaper, ArxivArticle, PaperTag } from "./types";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";

const ModelAnalysisSchema = z.object({
  sentenceSummary: z.string().min(1),
  hypothesis: z.string().min(1),
  method: z.string().min(1),
  problem: z.string().min(1),
  conclusion: z.string().min(1),
  tags: z
    .object({
      egocentric: z.boolean().default(false),
      customHardware: z.boolean().default(false),
    })
    .default({ egocentric: false, customHardware: false }),
  tagEvidence: z
    .object({
      egocentric: z.string().optional(),
      customHardware: z.string().optional(),
    })
    .default({}),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

type ModelAnalysis = z.infer<typeof ModelAnalysisSchema>;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface AnalysisResult {
  paper?: AnalyzedPaper;
  error?: string;
}

function getOpenAiBaseUrl() {
  return (process.env.OPENAI_URL || DEFAULT_OPENAI_URL).replace(/\/+$/, "");
}

function getOpenAiModel() {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function compactAbstract(abstract: string) {
  if (abstract.length <= 3800) {
    return abstract;
  }

  return `${abstract.slice(0, 3800)}...`;
}

function detectEgocentricByKeyword(article: ArxivArticle) {
  const text = `${article.title}\n${article.abstract}`.toLowerCase();
  return /\b(egocentric|ego-centric|first-person|first person|head-mounted|head mounted|body-mounted|fpv|wearable camera)\b/.test(
    text,
  );
}

function detectCustomHardwareByKeyword(article: ArxivArticle) {
  const text = `${article.title}\n${article.abstract}`.toLowerCase();
  return /\b(custom[-\s]?built|self-designed|bespoke|prototype hardware|camera rig|sensor rig|data collection rig|collection hardware|acquisition hardware)\b/.test(
    text,
  ) ||
    /\b(we|this paper|this work|we also)\s+(design|designed|build|built|develop|developed|construct|constructed|fabricate|fabricated|introduce|introduced)\b[\s\S]{0,120}\b(hardware|device|rig|wearable|sensor suite|data collection platform|acquisition system)\b/.test(
      text,
    );
}

function toTags(article: ArxivArticle, analysis: ModelAnalysis) {
  const tags = new Set<PaperTag>();
  const tagEvidence: Partial<Record<PaperTag, string>> = {};

  if (analysis.tags.egocentric || detectEgocentricByKeyword(article)) {
    tags.add("egocentric");
    tagEvidence.egocentric =
      analysis.tagEvidence.egocentric || "Title or abstract mentions egocentric/first-person sensing.";
  }

  if (analysis.tags.customHardware || detectCustomHardwareByKeyword(article)) {
    tags.add("custom_hardware");
    tagEvidence.custom_hardware =
      analysis.tagEvidence.customHardware ||
      "Title or abstract indicates custom data-collection hardware.";
  }

  return {
    tags: Array.from(tags),
    tagEvidence,
  };
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}

async function requestAnalysis(article: ArxivArticle, useJsonMode: boolean) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const body = {
    model: getOpenAiModel(),
    temperature: 0.15,
    response_format: useJsonMode ? { type: "json_object" } : undefined,
    messages: [
      {
        role: "system",
        content:
          "你是机器人论文读者。只根据标题和摘要做保守判断，返回 JSON，不要 Markdown。summary 必须是中文一句话，并同时覆盖：提出什么假设、用了什么方法、解决什么问题、结论如何。customHardware 只在论文明确设计/自建用于数据采集的硬件、设备、传感器或采集 rig 时为 true；普通使用机器人平台或传感器不算。",
      },
      {
        role: "user",
        content: JSON.stringify({
          title: article.title,
          authors: article.authors,
          abstract: compactAbstract(article.abstract),
          requiredJsonShape: {
            sentenceSummary: "中文一句话",
            hypothesis: "论文提出或隐含的假设；不明确则写未明确",
            method: "核心方法",
            problem: "要解决的问题",
            conclusion: "摘要中的结论或实验结果；不明确则写未明确",
            tags: {
              egocentric: "boolean",
              customHardware: "boolean",
            },
            tagEvidence: {
              egocentric: "evidence string when true",
              customHardware: "evidence string when true",
            },
            confidence: "0 to 1",
          },
        }),
      },
    ],
  };

  const response = await fetch(`${getOpenAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`OpenAI-compatible API failed: ${response.status} ${text.slice(0, 500)}`);
  }

  const parsed = JSON.parse(text) as ChatCompletionResponse;
  const content = parsed.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(parsed.error?.message || "OpenAI-compatible API returned no content");
  }

  return content;
}

async function analyzeArticleWithModel(article: ArxivArticle): Promise<ModelAnalysis> {
  let content: string;

  try {
    content = await requestAnalysis(article, true);
  } catch (error) {
    const message = String((error as Error).message);
    if (!message.includes("response_format") && !message.includes("400")) {
      throw error;
    }

    content = await requestAnalysis(article, false);
  }

  return ModelAnalysisSchema.parse(JSON.parse(extractJson(content)));
}

export async function analyzeArticle(
  article: ArxivArticle,
  runId: string,
): Promise<AnalyzedPaper> {
  const analysis = await analyzeArticleWithModel(article);
  const { tags, tagEvidence } = toTags(article, analysis);

  return {
    ...article,
    summary: analysis.sentenceSummary.replace(/\s+/g, " ").trim(),
    hypothesis: analysis.hypothesis,
    method: analysis.method,
    problem: analysis.problem,
    conclusion: analysis.conclusion,
    tags,
    tagEvidence,
    model: getOpenAiModel(),
    confidence: analysis.confidence,
    analyzedAt: new Date().toISOString(),
    runId,
  };
}

export async function analyzeArticles(
  articles: ArxivArticle[],
  runId: string,
  concurrency = Number(process.env.OPENAI_CONCURRENCY || 3),
) {
  const results: AnalysisResult[] = new Array(articles.length);
  const workerCount = Number.isFinite(concurrency)
    ? Math.min(Math.max(1, Math.floor(concurrency)), articles.length)
    : Math.min(3, articles.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < articles.length) {
      const index = nextIndex;
      nextIndex += 1;
      const article = articles[index];

      try {
        results[index] = {
          paper: await analyzeArticle(article, runId),
        };
      } catch (error) {
        results[index] = {
          error: (error as Error).message,
        };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return {
    papers: results
      .map((result) => result.paper)
      .filter((paper): paper is AnalyzedPaper => Boolean(paper)),
    failures: results
      .map((result, index) =>
        result.error
          ? {
              id: articles[index].id,
              title: articles[index].title,
              error: result.error,
            }
          : undefined,
      )
      .filter((failure): failure is { id: string; title: string; error: string } =>
        Boolean(failure),
      ),
  };
}
