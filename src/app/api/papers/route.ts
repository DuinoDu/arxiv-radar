import { NextRequest, NextResponse } from "next/server";
import { parseTagFilter } from "@/lib/arxiv/filters";
import {
  getPaperListPage,
  normalizePaperDateKey,
  normalizePageLimit,
  normalizePageOffset,
} from "@/lib/arxiv/paper-list";
import { readArxivState } from "@/lib/arxiv/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parsePaperIds(url: URL): string[] | undefined {
  const values = [
    ...url.searchParams.getAll("id"),
    ...url.searchParams.getAll("ids"),
  ]
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return values.length ? Array.from(new Set(values)) : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const filter = parseTagFilter(url.searchParams.get("tag"));
    const offset = normalizePageOffset(url.searchParams.get("offset"));
    const limit = normalizePageLimit(url.searchParams.get("limit"));
    const dateKey = normalizePaperDateKey(url.searchParams.get("date"));
    const state = await readArxivState();
    const page = getPaperListPage(state, filter, {
      offset,
      limit,
      dateKey,
      paperIds: parsePaperIds(url),
    });

    return NextResponse.json({ ok: true, ...page });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
        papers: [],
        total: 0,
        offset: 0,
        limit: 0,
        hasMore: false,
      },
      { status: 500 },
    );
  }
}
