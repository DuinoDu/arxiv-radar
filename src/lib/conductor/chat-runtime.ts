import { DEFAULT_CONDUCTOR_APP_NAME } from "@/lib/app-settings";
import type { AppSettings } from "@/lib/arxiv/types";
import type { AuthSession } from "@/lib/auth/session";
import { getConductorClient } from "@/lib/conductor/client";
import {
  listConductorAgents,
  type ConductorAgentOption,
} from "@/lib/conductor/raw-fetch";

export type ChatWorkspaceSource = "agent" | "project" | "default";

/**
 * Chat workspace on a daemon that has no arxiv-radar project yet, relative to
 * the daemon user's home. `bindArxivRadarProject` resolves `~` on the daemon
 * itself (and creates the directory), since every host has a different $HOME.
 */
export const DEFAULT_CHAT_WORKSPACE_PATH = `~/ws/fires/${DEFAULT_CONDUCTOR_APP_NAME}`;

export interface ChatRuntimeOptions {
  daemons: ConductorAgentOption[];
  selectedDaemonHost: string;
  selectedBackendType: string;
  workspacePath: string;
  workspaceSource: ChatWorkspaceSource;
  agentsError?: string;
}

export interface ChatRuntimeRequest {
  preferredDaemonHost?: string;
  preferredBackendType?: string;
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function basename(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

export function appWorkspacePathFromRoot(root: string, appName = DEFAULT_CONDUCTOR_APP_NAME) {
  const trimmed = root.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return "";
  if (basename(trimmed) === appName) return trimmed;
  return `${trimmed}/${appName}`;
}

function chooseDaemonHost(
  daemons: ConductorAgentOption[],
  settings: AppSettings,
  request: ChatRuntimeRequest,
) {
  const preferred = clean(request.preferredDaemonHost);
  if (preferred) return preferred;
  const configured = clean(settings.conductor.daemonHost);
  if (configured && daemons.some((daemon) => daemon.host === configured)) {
    return configured;
  }
  return daemons[0]?.host ?? configured;
}

function chooseBackendType(
  daemon: ConductorAgentOption | undefined,
  settings: AppSettings,
  request: ChatRuntimeRequest,
) {
  const available = daemon?.supportedBackends ?? [];
  const preferred = clean(request.preferredBackendType);
  if (preferred && (available.length === 0 || available.includes(preferred))) {
    return preferred;
  }
  const configured = clean(settings.conductor.backendType);
  if (configured && (available.length === 0 || available.includes(configured))) {
    return configured;
  }
  return available[0] ?? "";
}

async function projectWorkspacePath(
  session: AuthSession,
  daemonHost: string,
): Promise<string> {
  if (!daemonHost) return "";
  try {
    const client = await getConductorClient(session);
    const projects = await client.projects.list();
    const match = projects.find(
      (project) =>
        project.name === DEFAULT_CONDUCTOR_APP_NAME &&
        project.daemonHost === daemonHost &&
        Boolean(project.workspacePath),
    );
    return match?.workspacePath ?? "";
  } catch {
    return "";
  }
}

async function resolveWorkspacePath(args: {
  session: AuthSession;
  daemon?: ConductorAgentOption;
  daemonHost: string;
}): Promise<{ workspacePath: string; workspaceSource: ChatWorkspaceSource }> {
  const agentWorkspacePath = clean(args.daemon?.workspacePath);
  if (agentWorkspacePath) {
    return { workspacePath: agentWorkspacePath, workspaceSource: "agent" };
  }

  const agentWorkspaceRoot = clean(args.daemon?.workspaceRoot);
  if (agentWorkspaceRoot) {
    return {
      workspacePath: appWorkspacePathFromRoot(agentWorkspaceRoot),
      workspaceSource: "agent",
    };
  }

  const existingProjectWorkspace = await projectWorkspacePath(args.session, args.daemonHost);
  if (existingProjectWorkspace) {
    return {
      workspacePath: existingProjectWorkspace,
      workspaceSource: "project",
    };
  }

  return { workspacePath: DEFAULT_CHAT_WORKSPACE_PATH, workspaceSource: "default" };
}

export async function readChatRuntimeOptions(
  session: AuthSession,
  settings: AppSettings,
  request: ChatRuntimeRequest = {},
): Promise<ChatRuntimeOptions> {
  let daemons: ConductorAgentOption[] = [];
  let agentsError = "";
  try {
    daemons = await listConductorAgents(session);
  } catch (error) {
    agentsError = (error as Error).message || "读取 Conductor daemon 失败";
  }

  const selectedDaemonHost = chooseDaemonHost(daemons, settings, request);
  const selectedDaemon = daemons.find((daemon) => daemon.host === selectedDaemonHost);
  const selectedBackendType = chooseBackendType(selectedDaemon, settings, request);
  const { workspacePath, workspaceSource } = await resolveWorkspacePath({
    session,
    daemon: selectedDaemon,
    daemonHost: selectedDaemonHost,
  });

  return {
    daemons,
    selectedDaemonHost,
    selectedBackendType,
    workspacePath,
    workspaceSource,
    ...(agentsError ? { agentsError } : {}),
  };
}
