import { NextRequest, NextResponse } from "next/server";
import { readAppSettings, updatePaperTags } from "@/lib/arxiv/store";
import { PAPER_TAGS, type PaperTag } from "@/lib/arxiv/types";
import { requireAuthSession } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function decodeRouteId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseTags(rawTags: unknown, allowedIds: ReadonlySet<string>): PaperTag[] | null {
  if (!Array.isArray(rawTags)) {
    return null;
  }

  const validTags = new Set<PaperTag>();
  for (const tag of rawTags) {
    if (typeof tag !== "string") {
      return null;
    }

    if (!allowedIds.has(tag)) {
      return null;
    }

    validTags.add(tag as PaperTag);
  }

  return Array.from(validTags);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const paperId = decodeRouteId(id);

  if (!paperId) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  let body: { tags?: unknown };
  try {
    body = (await request.json()) as { tags?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求体必须是 JSON" }, { status: 400 });
  }

  // Build allowed tag set from hardcoded tags + user-defined tags
  const settings = await readAppSettings(auth.session.user.id);
  const allowedIds = new Set<string>(PAPER_TAGS as readonly string[]);
  for (const tc of settings.tags) {
    allowedIds.add(tc.id);
  }

  const tags = parseTags(body.tags, allowedIds);
  if (!tags) {
    return NextResponse.json(
      { ok: false, error: "tags 必须是合法 tag 字符串数组" },
      { status: 400 },
    );
  }

  try {
    const savedTags = await updatePaperTags(auth.session.user.id, paperId, tags, allowedIds);
    if (!savedTags) {
      return NextResponse.json(
        { ok: false, error: "paper 不存在" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, id: paperId, tags: savedTags });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
