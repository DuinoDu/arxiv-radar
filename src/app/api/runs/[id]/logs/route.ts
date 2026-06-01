import { NextResponse } from "next/server";
import { readRunLogs, runBelongsToUser } from "@/lib/arxiv/store";
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
    const userId = auth.session.user.id;
    const belongs = await runBelongsToUser(userId, runId);
    if (!belongs) {
      return NextResponse.json(
        { ok: false, error: "run 不存在" },
        { status: 404 },
      );
    }

    const logs = await readRunLogs(userId, runId);
    return NextResponse.json({ ok: true, runId, logs });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
