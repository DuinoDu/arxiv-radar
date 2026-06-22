import { NextRequest, NextResponse } from "next/server";
import { analyzeArticle } from "@/lib/arxiv/analyzer";
import { ExternalPdfError, fetchExternalPdfArticle } from "@/lib/arxiv/external-pdf";
import { fetchArticleMetadata, normalizeArxivId } from "@/lib/arxiv/fetcher";
import { normalizeXOrXhsUrl } from "@/lib/arxiv/social-links";
import { addManualPaper, readAppSettings, readArxivState } from "@/lib/arxiv/store";
import { PAPER_TAGS, type AnalyzedPaper, type AppSettings, type ArxivArticle, type PaperTag } from "@/lib/arxiv/types";
import { requireAuthSession } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ManualPaperBody {
  input?: string;
  tags?: string[];
  xUrl?: string;
  force?: boolean;
}

function allowedTagIds(settings: AppSettings) {
  const ids = new Set<string>(PAPER_TAGS as readonly string[]);
  for (const tag of settings.tags) {
    ids.add(tag.id);
  }
  return ids;
}

function parseTags(rawTags: unknown, allowedIds: ReadonlySet<string>): PaperTag[] {
  if (!Array.isArray(rawTags)) {
    return [];
  }

  const validTags = new Set<PaperTag>();
  for (const tag of rawTags) {
    if (typeof tag === "string" && allowedIds.has(tag)) {
      validTags.add(tag);
    }
  }

  return Array.from(validTags);
}

function mergeTags(analyzed: AnalyzedPaper, manualTags: PaperTag[]): AnalyzedPaper {
  if (manualTags.length === 0) {
    return analyzed;
  }

  const tagSet = new Set<PaperTag>([...analyzed.tags, ...manualTags]);
  const tagEvidence = { ...analyzed.tagEvidence };
  const tagConfidence = { ...(analyzed.tagConfidence ?? {}) };
  const tagSource = { ...(analyzed.tagSource ?? {}) };

  for (const tag of manualTags) {
    if (!analyzed.tags.includes(tag)) {
      tagEvidence[tag] = tagEvidence[tag] || "用户手动标记";
      tagConfidence[tag] = 1;
      tagSource[tag] = "abstract";
    }
  }

  return {
    ...analyzed,
    tags: Array.from(tagSet),
    tagEvidence,
    tagConfidence,
    tagSource,
  };
}

function externalPdfPaper(article: ArxivArticle, runId: string): AnalyzedPaper {
  const now = new Date().toISOString();
  return {
    ...article,
    summary: "非 arXiv PDF，已添加 PDF 原文链接，可在 chat 中基于 PDF 讨论。",
    hypothesis: "未分析（非 arXiv PDF）",
    method: "未分析（非 arXiv PDF）",
    problem: "未分析（非 arXiv PDF）",
    conclusion: "未分析（非 arXiv PDF）",
    tags: [],
    tagEvidence: {},
    tagConfidence: {},
    tagSource: {},
    fullTextStatus: "unavailable",
    fullTextUrl: article.pdfUrl,
    fullTextError: "直接 PDF 已验证；应用添加时不抽取 PDF 正文。",
    fullTextAnalyzedAt: now,
    sourceType: "external_pdf",
    model: "manual-external-pdf",
    analyzedAt: now,
    runId,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  let payload: ManualPaperBody;

  try {
    payload = (await request.json()) as ManualPaperBody;
  } catch {
    return NextResponse.json({ ok: false, error: "请求体必须是 JSON" }, { status: 400 });
  }

  const rawInput = typeof payload.input === "string" ? payload.input.trim() : "";
  if (!rawInput) {
    return NextResponse.json(
      { ok: false, error: "请提供 arxiv 链接、论文 ID 或可直接访问的 PDF 链接" },
      { status: 400 },
    );
  }

  if (payload.xUrl !== undefined && typeof payload.xUrl !== "string") {
    return NextResponse.json(
      { ok: false, error: "xUrl 必须是字符串" },
      { status: 400 },
    );
  }

  const manualXUrl = normalizeXOrXhsUrl(payload.xUrl);
  if (typeof payload.xUrl === "string" && payload.xUrl.trim() && !manualXUrl) {
    return NextResponse.json(
      { ok: false, error: "无效的 X / xhs 链接，请使用 x.com、twitter.com 或 xiaohongshu.com 链接" },
      { status: 400 },
    );
  }

  try {
    const settings = await readAppSettings(auth.session.user.id);
    const manualTags = parseTags(payload.tags, allowedTagIds(settings));
    const runId = `manual_${Date.now().toString(36)}`;
    const arxivId = normalizeArxivId(rawInput);
    const isArxivInput = Boolean(
      arxivId && /^([a-z\-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,6})$/i.test(arxivId),
    );
    let finalPaper: AnalyzedPaper;

    if (isArxivInput) {
      if (!payload.force) {
        const state = await readArxivState(auth.session.user.id);
        if (state.papers.some((paper) => paper.id === arxivId)) {
          return NextResponse.json(
            { ok: false, error: `论文已存在：${arxivId}`, paperId: arxivId },
            { status: 409 },
          );
        }
      }

      const articles = await fetchArticleMetadata([arxivId]);
      const article = articles[0];
      if (!article) {
        return NextResponse.json(
          { ok: false, error: `从 arxiv 获取元数据失败：${arxivId}` },
          { status: 404 },
        );
      }

      finalPaper = {
        ...mergeTags(await analyzeArticle(article, runId), manualTags),
        ...(manualXUrl ? { xUrl: manualXUrl } : {}),
      };
    } else {
      let article: ArxivArticle;
      try {
        article = await fetchExternalPdfArticle(rawInput);
      } catch (error) {
        const message =
          error instanceof ExternalPdfError
            ? error.message
            : `无法解析 arxiv ID 或直接 PDF 链接，请检查输入：${rawInput}`;
        return NextResponse.json({ ok: false, error: message }, { status: 400 });
      }

      if (!payload.force) {
        const state = await readArxivState(auth.session.user.id);
        if (state.papers.some((paper) => paper.id === article.id)) {
          return NextResponse.json(
            { ok: false, error: `论文已存在：${article.title}`, paperId: article.id },
            { status: 409 },
          );
        }
      }

      finalPaper = {
        ...mergeTags(externalPdfPaper(article, runId), manualTags),
        ...(manualXUrl ? { xUrl: manualXUrl } : {}),
      };
    }

    await addManualPaper(auth.session.user.id, finalPaper);

    return NextResponse.json({ ok: true, paper: finalPaper });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
