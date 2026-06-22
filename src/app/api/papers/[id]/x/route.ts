import { NextRequest, NextResponse } from "next/server";
import { normalizeXOrXhsUrl } from "@/lib/arxiv/social-links";
import { updatePaperXUrl } from "@/lib/arxiv/store";
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

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const paperId = decodeRouteId(id);

  if (!paperId) {
    return NextResponse.json({ ok: false, error: "missing id" }, { status: 400 });
  }

  let body: { xUrl?: unknown };
  try {
    body = (await request.json()) as { xUrl?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (typeof body.xUrl !== "string" || !body.xUrl.trim()) {
    return NextResponse.json(
      { ok: false, error: "xUrl 必须是非空字符串" },
      { status: 400 },
    );
  }

  const normalized = normalizeXOrXhsUrl(body.xUrl);
  if (!normalized) {
    return NextResponse.json(
      { ok: false, error: "无效的 X / xhs 链接" },
      { status: 400 },
    );
  }

  try {
    const mutated = await updatePaperXUrl(auth.session.user.id, paperId, normalized);
    if (!mutated) {
      return NextResponse.json(
        { ok: false, error: "论文不存在或已被删除" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, id: paperId, xUrl: normalized });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
