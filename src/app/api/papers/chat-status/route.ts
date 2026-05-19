import { NextResponse } from "next/server";
import { readArxivState } from "@/lib/arxiv/store";
import { getConductorClient } from "@/lib/conductor/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunningChatResponse = {
  runningPaperIds: string[];
};

function conductorReadConfigured() {
  return Boolean(process.env.CONDUCTOR_BASE_URL && process.env.CONDUCTOR_TOKEN);
}

export async function GET() {
  const state = await readArxivState();
  const visiblePaperIds = new Set(
    state.papers.filter((paper) => !paper.removed).map((paper) => paper.id),
  );
  const paperTasks = Object.entries(state.paperTasks ?? {}).filter(([paperId]) =>
    visiblePaperIds.has(paperId),
  );

  if (paperTasks.length === 0 || !conductorReadConfigured()) {
    return NextResponse.json({ runningPaperIds: [] } satisfies RunningChatResponse);
  }

  try {
    const client = await getConductorClient();
    const taskToPaperId = new Map<string, string>();
    const projectIds = new Set<string>();

    for (const [paperId, binding] of paperTasks) {
      taskToPaperId.set(binding.taskId, paperId);
      projectIds.add(binding.projectId);
    }

    const runningTasks = (
      await Promise.all(
        Array.from(projectIds).map((projectId) =>
          client.tasks.list({ projectId, status: "running" }),
        ),
      )
    ).flat();

    const runningPaperIds = runningTasks
      .map((task) => taskToPaperId.get(task.id))
      .filter((paperId): paperId is string => Boolean(paperId));

    return NextResponse.json({ runningPaperIds } satisfies RunningChatResponse);
  } catch (error) {
    console.warn("[paper-chat-status] failed to read running tasks", error);
    return NextResponse.json({ runningPaperIds: [] } satisfies RunningChatResponse);
  }
}
