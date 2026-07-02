import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_CONDUCTOR_APP_NAME } from "@/lib/app-settings";
import { buildPaperInitialChatMessage } from "@/lib/arxiv/chat";
import { readAppSettings, readArxivState } from "@/lib/arxiv/store";
import { getCurrentAuthSession } from "@/lib/auth/session";
import { readChatRuntimeOptions } from "@/lib/conductor/chat-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authenticationRequired() {
  return NextResponse.json(
    { error: "请先使用 Conductor 登录", code: "authentication_required" },
    { status: 401 },
  );
}

export async function GET(request: NextRequest) {
  const session = await getCurrentAuthSession();
  if (!session) return authenticationRequired();

  const url = new URL(request.url);
  const paperId = url.searchParams.get("paperId")?.trim() || "";
  if (!paperId) {
    return NextResponse.json({ error: "paperId is required" }, { status: 400 });
  }

  const [state, settings] = await Promise.all([
    readArxivState(session.user.id),
    readAppSettings(session.user.id),
  ]);
  const paper = state.papers.find((candidate) => candidate.id === paperId);
  if (!paper) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }

  const runtimeOptions = await readChatRuntimeOptions(session, settings);

  return NextResponse.json({
    appName: DEFAULT_CONDUCTOR_APP_NAME,
    initialMessage: buildPaperInitialChatMessage(paper),
    ...runtimeOptions,
  });
}
