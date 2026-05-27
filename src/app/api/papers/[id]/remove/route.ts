import { NextRequest, NextResponse } from "next/server";
import { markPaperRemoved } from "@/lib/arxiv/store";
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

export async function POST(_request: NextRequest, context: RouteContext) {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const paperId = decodeRouteId(id);

  if (!paperId) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  try {
    const mutated = await markPaperRemoved(paperId);
    return NextResponse.json({ ok: true, id: paperId, mutated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
