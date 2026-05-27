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
 * the BFF trust boundary is unchanged — the token never leaves Node except
 * when the user edits it in the settings popup.
 */
import { requireConductorValue } from "@/lib/app-settings";
import { readAppSettings } from "@/lib/arxiv/store";
import type { AuthSession } from "@/lib/auth/session";

async function getRawConductorConfig(session?: AuthSession) {
  if (session) {
    return {
      baseUrl: requireConductorValue(session.conductorBaseUrl, "baseUrl").replace(/\/+$/, ""),
      authHeader: `Bearer ${requireConductorValue(session.conductorAccessToken, "token")}`,
    };
  }

  const settings = await readAppSettings();
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
