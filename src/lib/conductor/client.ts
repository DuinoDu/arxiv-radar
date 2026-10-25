/**
 * Conductor App SDK clients keyed by the credential that owns the task.
 *
 * SSO sessions receive distinct Conductor tokens. Sharing a singleton would
 * either expose one user's task stream to another or make valid tasks appear
 * missing, so browser-facing routes pass their authenticated session here.
 */
import { connect, type AppClient } from "@love-moon/app-sdk/server";
import {
  conductorApiBaseUrl,
  DEFAULT_CONDUCTOR_APP_NAME,
  createEnvAppSettings,
  requireConductorValue,
} from "@/lib/app-settings";
import { readAppSettings } from "@/lib/arxiv/store";
import type { AuthSession } from "@/lib/auth/session";
import { execOnConductorDaemon } from "./raw-fetch";

const MAX_CACHED_CLIENTS = 32;
const cachedClients = new Map<string, Promise<AppClient>>();

function clientConfigKey(baseUrl: string, token: string, sessionScope = "configured") {
  return `${sessionScope}\n${baseUrl}\n${token}`;
}

export function resetConductorClient() {
  const clients = Array.from(cachedClients.values());
  cachedClients.clear();
  for (const client of clients) {
    void client.then((connected) => connected.close()).catch(() => undefined);
  }
}

export async function releaseConductorSessionClient(session: AuthSession) {
  const configKey = clientConfigKey(
    session.conductorBaseUrl,
    session.conductorAccessToken,
    session.sessionId,
  );
  const client = cachedClients.get(configKey);
  if (!client) return;
  cachedClients.delete(configKey);
  await client.then((connected) => connected.close()).catch(() => undefined);
}

async function getConnectionConfig(session?: AuthSession) {
  if (session) {
    return {
      baseUrl: conductorApiBaseUrl(requireConductorValue(session.conductorBaseUrl, "baseUrl")),
      bearerToken: requireConductorValue(session.conductorAccessToken, "token"),
      sessionScope: session.sessionId,
    };
  }

  const settings = createEnvAppSettings();
  return {
    baseUrl: conductorApiBaseUrl(requireConductorValue(settings.conductor.baseUrl, "baseUrl")),
    bearerToken: requireConductorValue(settings.conductor.token, "token"),
    sessionScope: "configured",
  };
}

function trimClientCache() {
  while (cachedClients.size > MAX_CACHED_CLIENTS) {
    const oldest = cachedClients.entries().next().value as
      | [string, Promise<AppClient>]
      | undefined;
    if (!oldest) return;
    const [key, client] = oldest;
    cachedClients.delete(key);
    void client.then((connected) => connected.close()).catch(() => undefined);
  }
}

export async function getConductorClient(session?: AuthSession): Promise<AppClient> {
  const { baseUrl, bearerToken, sessionScope } = await getConnectionConfig(session);
  const configKey = clientConfigKey(baseUrl, bearerToken, sessionScope);

  const cached = cachedClients.get(configKey);
  if (cached) {
    cachedClients.delete(configKey);
    cachedClients.set(configKey, cached);
    return cached;
  }

  const promise = connect({
      baseUrl,
      bearerToken,
      // POST /api/tasks waits on daemon dispatch and often exceeds the 30s default.
      timeoutMs: 120_000,
      onUnauthorized: () => {
        console.error(
          "[conductor] 401 from Conductor - token invalid or revoked?",
        );
      },
    });
  cachedClients.set(configKey, promise);
  trimClientCache();
  promise.catch(() => {
    if (cachedClients.get(configKey) === promise) {
      cachedClients.delete(configKey);
    }
  });
  return promise;
}

interface BindArxivRadarProjectOptions {
  daemonHost?: string;
  workspacePath?: string;
}

/**
 * Makes sure `workspacePath` exists on the daemon and returns it as the
 * absolute path the daemon sees. A leading `~` means the daemon user's home,
 * which only the daemon knows, so this runs `mkdir -p` + `pwd` there through
 * Conductor's remote exec. Conductor itself rejects bindings to missing paths
 * and does not expand `~`.
 */
async function ensureDaemonWorkspace(
  daemonHost: string,
  workspacePath: string,
  session?: AuthSession,
) {
  const homeRelative = workspacePath === "~" || /^~[\\/]/.test(workspacePath);
  // Relative to the daemon's home, which is where remote exec starts.
  const target = homeRelative ? workspacePath.slice(2) || "." : workspacePath;
  try {
    const run = await execOnConductorDaemon(
      daemonHost,
      "sh",
      ["-c", 'mkdir -p -- "$1" && cd -- "$1" && pwd', "sh", target],
      session,
    );
    const resolved = (run.stdoutTail ?? "").trim().split(/\r?\n/).pop()?.trim() ?? "";
    if (resolved.startsWith("/")) return resolved;
    throw new Error(`unexpected output: ${resolved || "(empty)"}`);
  } catch (err) {
    // An absolute path (e.g. an existing project) can still be bound without
    // exec; Conductor reports a clear error if it is really missing.
    if (!homeRelative) return workspacePath;
    throw new Error(
      `无法在 daemon ${daemonHost} 上创建 chat workspace ${workspacePath}：${(err as Error).message}`,
    );
  }
}

/**
 * Idempotent project binding for this app. Matches Conductor's existing
 * project by (daemonHost, workspacePath); creates one on miss. The workspace
 * directory is created on the daemon first (see `ensureDaemonWorkspace`).
 */
export async function bindArxivRadarProject(
  session?: AuthSession,
  options: BindArxivRadarProjectOptions = {},
) {
  const settings = session
    ? await readAppSettings(session.user.id)
    : createEnvAppSettings();
  const daemonHost = requireConductorValue(
    options.daemonHost || settings.conductor.daemonHost,
    "daemonHost",
  );
  const workspacePath = await ensureDaemonWorkspace(
    daemonHost,
    requireConductorValue(options.workspacePath || settings.conductor.workspacePath, "workspacePath"),
    session,
  );

  const client = await getConductorClient(session);
  return client.projects.bind({
    name: DEFAULT_CONDUCTOR_APP_NAME,
    daemonHost,
    workspacePath,
  });
}
