import { DEFAULT_CONDUCTOR_APP_NAME } from "@/lib/app-settings";
import type { AppSettings } from "@/lib/arxiv/types";
import type { AuthSession } from "@/lib/auth/session";
import { getConductorClient } from "@/lib/conductor/client";
import {
  listConductorAgents,
  type ConductorAgentOption,
} from "@/lib/conductor/raw-fetch";

export type ChatWorkspaceSource = "agent" | "project" | "legacy-settings" | "unavailable";

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
  settings: AppSettings;
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

  const legacyWorkspacePath = clean(args.settings.conductor.workspacePath);
  if (legacyWorkspacePath) {
    return {
      workspacePath: legacyWorkspacePath,
      workspaceSource: "legacy-settings",
    };
  }

  return { workspacePath: "", workspaceSource: "unavailable" };
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
    settings,
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
