import { NextRequest, NextResponse } from "next/server";
import { updatePaperGithubUrl } from "@/lib/arxiv/store";
import { extractGithubUrl } from "@/lib/arxiv/fulltext";
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

  let body: { githubUrl?: unknown };
  try {
    body = (await request.json()) as { githubUrl?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "请求体必须是 JSON" }, { status: 400 });
  }

  if (typeof body.githubUrl !== "string" || !body.githubUrl.trim()) {
    return NextResponse.json(
      { ok: false, error: "githubUrl 必须是非空字符串" },
      { status: 400 },
    );
  }

  const normalized = extractGithubUrl(body.githubUrl);
  if (!normalized) {
    return NextResponse.json(
      { ok: false, error: "无效的 GitHub 仓库链接" },
      { status: 400 },
    );
  }

  try {
    const mutated = await updatePaperGithubUrl(auth.session.user.id, paperId, normalized);
    if (!mutated) {
      return NextResponse.json(
        { ok: false, error: "论文不存在或已被删除" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, id: paperId, githubUrl: normalized });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
