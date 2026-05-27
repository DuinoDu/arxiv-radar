import { NextRequest, NextResponse } from "next/server";
import { analyzeArticle } from "@/lib/arxiv/analyzer";
import { fetchArticleMetadata, normalizeArxivId } from "@/lib/arxiv/fetcher";
import { addManualPaper, readArxivState } from "@/lib/arxiv/store";
import { PAPER_TAGS, type AnalyzedPaper, type PaperTag } from "@/lib/arxiv/types";
import { requireAuthSession } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface ManualPaperBody {
  input?: string;
  tags?: string[];
  force?: boolean;
}

function parseTags(rawTags: unknown): PaperTag[] {
  if (!Array.isArray(rawTags)) {
    return [];
  }

  const validTags = new Set<PaperTag>();
  for (const tag of rawTags) {
    if (typeof tag === "string" && (PAPER_TAGS as readonly string[]).includes(tag)) {
      validTags.add(tag as PaperTag);
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
      { ok: false, error: "请提供 arxiv 链接或论文 ID" },
      { status: 400 },
    );
  }

  const arxivId = normalizeArxivId(rawInput);
  if (!arxivId || !/^([a-z\-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,6})$/i.test(arxivId)) {
    return NextResponse.json(
      { ok: false, error: `无法解析 arxiv ID，请检查输入：${rawInput}` },
      { status: 400 },
    );
  }

  const manualTags = parseTags(payload.tags);

  try {
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

    const runId = `manual_${Date.now().toString(36)}`;
    const analyzed = await analyzeArticle(article, runId);
    const finalPaper = mergeTags(analyzed, manualTags);

    await addManualPaper(auth.session.user.id, finalPaper);

    return NextResponse.json({ ok: true, paper: finalPaper });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
