import { NextResponse } from "next/server";
import { readArxivState } from "@/lib/arxiv/store";
import { getConductorClient } from "@/lib/conductor/client";
import { getCurrentAuthSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatStatusResponse = {
  boundPaperIds: string[];
  runningPaperIds: string[];
  killedPaperIds: string[];
};

type BoundPaperTask = {
  paperId: string;
  projectId: string;
  taskId: string;
};

function normalizeStatus(status: unknown) {
  return typeof status === "string" ? status.toLowerCase() : "";
}

function isRunningChatStatus(status: string) {
  return (
    status === "init" ||
    status === "pending" ||
    status === "running" ||
    status === "killing"
  );
}

function isKilledChatStatus(status: string) {
  return status === "killed" || status === "cancelled";
}

export async function GET() {
  const session = await getCurrentAuthSession();
  if (!session) {
    return NextResponse.json({
      boundPaperIds: [],
      runningPaperIds: [],
      killedPaperIds: [],
    } satisfies ChatStatusResponse);
  }

  const state = await readArxivState(session.user.id);
  const visiblePaperIds = new Set(
    state.papers.filter((paper) => !paper.removed).map((paper) => paper.id),
  );
  const paperTasks: BoundPaperTask[] = Object.entries(
    state.paperTasksByUser?.[session.user.id] ?? {},
  )
    .filter(([paperId]) => visiblePaperIds.has(paperId))
    .map(([paperId, binding]) => ({
      paperId,
      projectId: binding.projectId,
      taskId: binding.taskId,
    }));

  if (paperTasks.length === 0) {
    return NextResponse.json({
      boundPaperIds: [],
      runningPaperIds: [],
      killedPaperIds: [],
    } satisfies ChatStatusResponse);
  }

  try {
    const client = await getConductorClient(session);
    const taskById = new Map<string, { id: string; status?: unknown }>();
    const projectTasks = await Promise.all(
      Array.from(new Set(paperTasks.map((task) => task.projectId))).map((projectId) =>
        client.tasks.list({ projectId }),
      ),
    );
    for (const task of projectTasks.flat()) {
      taskById.set(task.id, task);
    }

    const missingTasks = paperTasks.filter((binding) => !taskById.has(binding.taskId));
    const fetchedMissingTasks = await Promise.allSettled(
      missingTasks.map((binding) => client.tasks.get(binding.taskId)),
    );
    for (const result of fetchedMissingTasks) {
      if (result.status === "fulfilled") {
        taskById.set(result.value.id, result.value);
      }
    }

    const runningPaperIds: string[] = [];
    const killedPaperIds: string[] = [];
    for (const binding of paperTasks) {
      const status = normalizeStatus(taskById.get(binding.taskId)?.status);
      if (isKilledChatStatus(status)) {
        killedPaperIds.push(binding.paperId);
      } else if (isRunningChatStatus(status)) {
        runningPaperIds.push(binding.paperId);
      }
    }

    return NextResponse.json({
      boundPaperIds: paperTasks.map((binding) => binding.paperId),
      runningPaperIds,
      killedPaperIds,
    } satisfies ChatStatusResponse);
  } catch (error) {
    console.warn("[paper-chat-status] failed to read chat task status", error);
    return NextResponse.json({
      boundPaperIds: paperTasks.map((binding) => binding.paperId),
      runningPaperIds: [],
      killedPaperIds: [],
    } satisfies ChatStatusResponse);
  }
}
