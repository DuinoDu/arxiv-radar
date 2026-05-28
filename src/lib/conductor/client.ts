/**
 * Conductor App SDK clients keyed by the credential that owns the task.
 *
 * SSO sessions receive distinct Conductor tokens. Sharing a singleton would
 * either expose one user's task stream to another or make valid tasks appear
 * missing, so browser-facing routes pass their authenticated session here.
 */
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { connect, type AppClient } from "@love-moon/app-sdk/server";
import { createEnvAppSettings, requireConductorValue } from "@/lib/app-settings";
import { readAppSettings } from "@/lib/arxiv/store";
import type { AuthSession } from "@/lib/auth/session";

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
      baseUrl: requireConductorValue(session.conductorBaseUrl, "baseUrl"),
      bearerToken: requireConductorValue(session.conductorAccessToken, "token"),
      sessionScope: session.sessionId,
    };
  }

  const settings = createEnvAppSettings();
  return {
    baseUrl: requireConductorValue(settings.conductor.baseUrl, "baseUrl"),
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

/**
 * Idempotent project binding for this app. Matches Conductor's existing
 * project by (daemonHost, workspacePath); creates one on miss.
 *
 * Best-effort `mkdir -p` of the workspace path first: when the daemon
 * lives on the same host as the BFF (the common dev setup —
 * CONDUCTOR_DAEMON_HOST=m1 + this Node process running on m1), the SDK's
 * daemon-side validation requires the path to already exist, otherwise it
 * 4xx's with "Workspace path does not exist on daemon ...". Creating it
 * here removes the manual `mkdir` step. For remote-daemon deployments the
 * local mkdir is harmless (creates a useless dir on the BFF host) — the
 * remote daemon will still 4xx and the operator can provision the path.
 */
export async function bindArxivRadarProject(session?: AuthSession) {
  const settings = session
    ? await readAppSettings(session.user.id)
    : createEnvAppSettings();
  const rawWorkspacePath = requireConductorValue(
    settings.conductor.workspacePath,
    "workspacePath",
  );
  const workspacePath = rawWorkspacePath.startsWith("~/")
    ? `${homedir()}${rawWorkspacePath.slice(1)}`
    : rawWorkspacePath === "~"
      ? homedir()
      : rawWorkspacePath;

  try {
    await fs.mkdir(workspacePath, { recursive: true });
  } catch (err) {
    // Swallow + warn: if this fails for real (EACCES, path-is-a-file),
    // the subsequent `projects.bind` call will surface a clearer error
    // from the daemon's own validation. We never want this mkdir to mask
    // the actual binding failure.
    console.warn(
      "[conductor] failed to ensure workspace path exists",
      { workspacePath, err },
    );
  }

  const client = await getConductorClient(session);
  return client.projects.bind({
    name: settings.conductor.appName || "arxiv-radar",
    daemonHost: requireConductorValue(settings.conductor.daemonHost, "daemonHost"),
    workspacePath,
  });
}
