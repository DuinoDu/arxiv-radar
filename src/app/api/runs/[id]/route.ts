import { NextResponse } from "next/server";
import { findRunForUser } from "@/lib/arxiv/store";
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

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const runId = decodeRouteId(id);
  if (!runId) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  try {
    const run = await findRunForUser(auth.session.user.id, runId);
    if (!run) {
      return NextResponse.json({ ok: false, error: "run 不存在" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
