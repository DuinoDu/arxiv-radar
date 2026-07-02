/**
 * Raw Conductor REST helper.
 *
 * `@love-moon/app-sdk/server` covers the messaging / subscribe surface
 * (history, sendMessage, interrupt, events, projects.bind, tasks.get/create),
 * but does NOT wrap task lifecycle endpoints (`PATCH /api/tasks/:id`,
 * `POST /api/tasks/:id/restart`). arxiv-radar's chat top bar mirrors
 * Conductor's task-card UX (running → kill?, killed → restart?), so we
 * call those endpoints directly here.
 *
 * Auth/base URL: reuses the same app settings the SDK client uses. This means
 * the BFF trust boundary is unchanged — the token never leaves Node.
 */
import { createEnvAppSettings, requireConductorValue } from "@/lib/app-settings";
import type { AuthSession } from "@/lib/auth/session";

async function getRawConductorConfig(session?: AuthSession) {
  if (session) {
    return {
      baseUrl: requireConductorValue(session.conductorBaseUrl, "baseUrl").replace(/\/+$/, ""),
      authHeader: `Bearer ${requireConductorValue(session.conductorAccessToken, "token")}`,
    };
  }

  const settings = createEnvAppSettings();
  return {
    baseUrl: requireConductorValue(settings.conductor.baseUrl, "baseUrl").replace(/\/+$/, ""),
    authHeader: `Bearer ${requireConductorValue(settings.conductor.token, "token")}`,
  };
}

export interface ConductorRawError {
  status: number;
  code?: string;
  message: string;
  body?: unknown;
}

export interface ConductorAgentOption {
  id: string;
  host: string;
  supportedBackends: string[];
  runtimeBackendMap?: Record<string, string>;
  capabilities?: string[];
  version?: string;
  workspaceRoot?: string;
  workspacePath?: string;
}

function makeError(status: number, body: unknown, fallback: string): ConductorRawError {
  const message =
    body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error ?? fallback)
      : fallback;
  const code =
    body && typeof body === "object" && "code" in body
      ? String((body as { code?: unknown }).code ?? "")
      : undefined;
  return { status, code: code || undefined, message, body };
}

function stringFromRecord(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "string") return [];
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    const normalizedKey = key.trim();
    const normalizedValue = raw.trim();
    if (!normalizedKey || !normalizedValue) continue;
    result[normalizedKey] = normalizedValue;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeConductorAgent(value: unknown): ConductorAgentOption | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const host = stringFromRecord(record, "host", "daemonHost", "daemon_host");
  if (!host) return null;
  const id = stringFromRecord(record, "id") || host;
  const runtimeBackendMap = stringRecord(record.runtimeBackendMap ?? record.runtime_backend_map);
  const capabilities = stringArray(record.capabilities);
  const version = stringFromRecord(record, "version");
  const workspaceRoot = stringFromRecord(
    record,
    "workspaceRoot",
    "workspace_root",
    "workspace",
  );
  const workspacePath = stringFromRecord(
    record,
    "workspacePath",
    "workspace_path",
    "projectWorkspacePath",
    "project_workspace_path",
  );
  return {
    id,
    host,
    supportedBackends: stringArray(record.supportedBackends ?? record.supported_backends),
    ...(runtimeBackendMap ? { runtimeBackendMap } : {}),
    ...(capabilities.length ? { capabilities } : {}),
    ...(version ? { version } : {}),
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(workspacePath ? { workspacePath } : {}),
  };
}

/**
 * Read live Conductor daemon registrations. The public Conductor route returns
 * the current user's connected agents with their advertised backend aliases.
 */
export async function listConductorAgents(session?: AuthSession): Promise<ConductorAgentOption[]> {
  const config = await getRawConductorConfig(session);
  const url = `${config.baseUrl}/api/agents`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: config.authHeader,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeError(response.status, body, `agents failed (${response.status})`);
  }
  const rawAgents = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { agents?: unknown }).agents)
      ? (body as { agents: unknown[] }).agents
      : [];
  return rawAgents.flatMap((entry) => {
    const agent = normalizeConductorAgent(entry);
    return agent ? [agent] : [];
  });
}

/**
 * Kill a Conductor task. Maps to `PATCH /api/tasks/:id` with `{status: 'killed'}`.
 * Conductor's daemon picks up the change and starts the kill sequence
 * (response status: 'killing' typically, transitions to 'killed').
 */
export async function killConductorTask(taskId: string, session?: AuthSession): Promise<unknown> {
  const config = await getRawConductorConfig(session);
  const url = `${config.baseUrl}/api/tasks/${encodeURIComponent(taskId)}`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: config.authHeader,
    },
    body: JSON.stringify({ status: "killed" }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeError(response.status, body, `kill failed (${response.status})`);
  }
  return body;
}

/**
 * Delete a Conductor task. Maps to `DELETE /api/tasks/:id`. Used by the paper
 * card's "del?" affordance to tear down a chat session entirely (as opposed to
 * `kill`, which only stops a running task but keeps it around).
 *
 * A 404 is treated as success: the task is already gone, which is exactly the
 * post-condition the caller wants. Any other non-2xx is surfaced so the caller
 * can fall back (e.g. to `kill`) when a given daemon build doesn't expose DELETE.
 */
export async function deleteConductorTask(taskId: string, session?: AuthSession): Promise<void> {
  const config = await getRawConductorConfig(session);
  const url = `${config.baseUrl}/api/tasks/${encodeURIComponent(taskId)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
      Authorization: config.authHeader,
    },
  });
  if (response.status === 404) return;
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw makeError(response.status, body, `delete failed (${response.status})`);
  }
}

/**
 * Restart a Conductor task. Maps to `POST /api/tasks/:id/restart` with
 * `{strategy, backend_type?}`. Conductor responds with the updated task
 * object (status typically transitions back to 'init' / 'running').
 *
 * `backendType` lets a restart switch the task onto a different daemon
 * CLI (mapped via `allow_cli_list`). When omitted, the daemon reuses
 * whatever backend the task was created with.
 */
export async function restartConductorTask(
  taskId: string,
  options: { strategy?: "inplace" | "fresh"; backendType?: string } = {},
  session?: AuthSession,
): Promise<unknown> {
  const config = await getRawConductorConfig(session);
  const url = `${config.baseUrl}/api/tasks/${encodeURIComponent(taskId)}/restart`;
  const body: Record<string, unknown> = {
    strategy: options.strategy ?? "inplace",
  };
  if (options.backendType) body.backend_type = options.backendType;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: config.authHeader,
    },
    body: JSON.stringify(body),
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeError(
      response.status,
      responseBody,
      `restart failed (${response.status})`,
    );
  }
  return responseBody;
}

/** Type-guard for callers. */
export function isConductorRawError(error: unknown): error is ConductorRawError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}
