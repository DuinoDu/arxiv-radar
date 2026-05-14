import { NextResponse } from "next/server";
import { appendPaperChatExchange, readPaperChatMessages } from "@/lib/arxiv/chat-history";
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
    const history = await readPaperChatMessages(paper.id);
    const userMessage = {
      role: "user" as const,
      content: parsed.data.content,
    };
    const answer = await askPaperQuestion(paper, [
      ...history.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      userMessage,
    ]);
    const messages = await appendPaperChatExchange({
      assistantContent: answer.content,
      model: answer.model,
      paperId: paper.id,
      userContent: parsed.data.content,
    });

    return NextResponse.json({
      message: {
        role: answer.role,
        content: answer.content,
      },
      messages,
      model: answer.model,
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const paperId = decodeRouteId(id);
  const state = await readArxivState();
  const paper = state.papers.find((candidate) => candidate.id === paperId);

  if (!paper) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }

  const messages = await readPaperChatMessages(paper.id);

  return NextResponse.json({ messages });
}
