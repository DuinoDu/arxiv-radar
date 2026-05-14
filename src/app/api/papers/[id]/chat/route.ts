import { NextResponse } from "next/server";
import { askPaperQuestion, PaperChatRequestSchema } from "@/lib/arxiv/chat";
import { readArxivState } from "@/lib/arxiv/store";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function decodeRouteId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const paperId = decodeRouteId(id);
  const payload = await request.json().catch(() => undefined);
  const parsed = PaperChatRequestSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid chat request" }, { status: 400 });
  }

  const state = await readArxivState();
  const paper = state.papers.find((candidate) => candidate.id === paperId);

  if (!paper) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }

  try {
    const answer = await askPaperQuestion(paper, parsed.data.messages);

    return NextResponse.json({
      message: {
        role: answer.role,
        content: answer.content,
      },
      model: answer.model,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
