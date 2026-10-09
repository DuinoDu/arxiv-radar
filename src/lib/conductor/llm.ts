/**
 * One-shot LLM completions through Conductor daemons' AI tools, so scoring can
 * spend subscription quota that is otherwise idle instead of paid API tokens.
 */
import { DEFAULT_CONDUCTOR_APP_NAME } from "@/lib/app-settings";
import { getConductorClient } from "./client";
import {
  deleteConductorTask,
  getConductorQuota,
  killConductorTask,
  listConductorAgents,
} from "./raw-fetch";

// Subscription tools with a usage window. `dsh` is left out on purpose: it is
// DeepSeek billed per token, i.e. the paid path this module exists to avoid.
const QUOTA_TOOLS = ["codex", "claude", "kimi", "copilot"];
const MIN_REMAINING_PERCENT = 10;
const REPLY_IDLE_TIMEOUT_MS = 5 * 60_000;

export interface ConductorLlmCandidate {
  daemonHost: string;
  backendType: string;
  projectId: string;
  remainingPercent: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Tightest remaining window of a tool's quota, or null when it is unusable. */
function remainingPercent(quota: unknown) {
  if (!isRecord(quota) || quota.error || quota.source === "unknown") return null;
  const windows = [quota.fiveHour, quota.weekly, quota.primary].flatMap((window) =>
    isRecord(window) && typeof window.remainingPercent === "number" ? [window.remainingPercent] : [],
  );
  return windows.length > 0 ? Math.min(...windows) : null;
}

/**
 * Daemon tools that still have quota, most remaining first. Only daemons that
 * already have this app's chat project are considered, since a task needs a
 * workspace on the daemon.
 */
export async function listConductorLlmCandidates(): Promise<ConductorLlmCandidate[]> {
  const client = await getConductorClient();
  const [agents, projects] = await Promise.all([listConductorAgents(), client.projects.list()]);

  const perDaemon = await Promise.all(
    agents.map(async (agent) => {
      const project = projects.find(
        (item) => item.name === DEFAULT_CONDUCTOR_APP_NAME && item.daemonHost === agent.host,
      );
      if (!project) return [];
      const quota = await getConductorQuota(agent.host).catch(() => ({}) as Record<string, unknown>);
      return QUOTA_TOOLS.flatMap((tool) => {
        const remaining = remainingPercent(quota[tool]);
        return agent.supportedBackends.includes(tool) &&
          remaining !== null &&
          remaining >= MIN_REMAINING_PERCENT
          ? [{ daemonHost: agent.host, backendType: tool, projectId: project.id, remainingPercent: remaining }]
          : [];
      });
    }),
  );
  return perDaemon.flat().sort((a, b) => b.remainingPercent - a.remainingPercent);
}

/** Runs `prompt` as a throwaway task on the candidate's tool and returns the reply. */
export async function requestConductorCompletion(candidate: ConductorLlmCandidate, prompt: string) {
  const client = await getConductorClient();
  const task = await client.tasks.create({
    projectId: candidate.projectId,
    title: `arxiv-radar scoring ${new Date().toISOString()}`,
    initialMessage: prompt,
    backendType: candidate.backendType,
    metadata: { arxivRadar: { scoring: true } },
  });
  try {
    for await (const delta of client.tasks.streamReply(task.id, { idleTimeoutMs: REPLY_IDLE_TIMEOUT_MS })) {
      if (delta.type === "done") return delta.message.content;
      if (delta.type === "error") throw new Error(`${delta.error.code}: ${delta.error.message}`);
    }
    throw new Error("task ended without a reply");
  } catch (error) {
    // streamReply only sees live events, so a reply that landed while the
    // socket was lagging is missed; it is still in the task history.
    const { messages } = await client.tasks.history(task.id, { limit: 5 }).catch(() => ({ messages: [] }));
    const reply = messages.findLast((message) => (message.role === "sdk" || message.role === "assistant") && message.content);
    if (reply) return reply.content;
    throw error;
  } finally {
    await deleteConductorTask(task.id)
      .catch(() => killConductorTask(task.id))
      .catch(() => undefined);
  }
}
