/**
 * Conductor App SDK client singleton.
 *
 * One `AppClient` is shared across all Next.js Route Handlers in the same
 * Node process. The first call to `getClient()` opens a `/ws/app` WebSocket;
 * subsequent calls reuse it.
 *
 * Settings come from the app state written by the dashboard settings popup,
 * with env vars as the local-dev fallback. If the app gains a per-user
 * account system, change this to `getClient(userId)` backed by an LRU cache
 * so each user's Conductor session is isolated.
 */
import { promises as fs } from "node:fs";
import { connect, type AppClient } from "@love-moon/app-sdk/server";
import { requireConductorValue } from "@/lib/app-settings";
import { readAppSettings } from "@/lib/arxiv/store";

let cachedClient: AppClient | null = null;
let cachedClientPromise: Promise<AppClient> | null = null;
let cachedClientConfigKey: string | null = null;
let cachedClientPromiseConfigKey: string | null = null;

function clientConfigKey(baseUrl: string, token: string) {
  return `${baseUrl}\n${token}`;
}

export function resetConductorClient() {
  cachedClient = null;
  cachedClientPromise = null;
  cachedClientConfigKey = null;
  cachedClientPromiseConfigKey = null;
}

export async function getConductorClient(): Promise<AppClient> {
  const settings = await readAppSettings();
  const baseUrl = requireConductorValue(settings.conductor.baseUrl, "baseUrl");
  const bearerToken = requireConductorValue(settings.conductor.token, "token");
  const configKey = clientConfigKey(baseUrl, bearerToken);

  if (cachedClient && cachedClientConfigKey === configKey) return cachedClient;
  if (cachedClientPromise && cachedClientPromiseConfigKey === configKey) {
    return cachedClientPromise;
  }

  // Cache the *promise* so concurrent callers share one connect; clear the
  // cache on failure so the next caller retries from scratch instead of
  // re-receiving the same rejection forever.
  const promise = (async () => {
    const client = await connect({
      baseUrl,
      bearerToken,
      onUnauthorized: () => {
        console.error(
          "[conductor] 401 from Conductor — token invalid or revoked?",
        );
      },
    });
    cachedClient = client;
    cachedClientConfigKey = configKey;
    return client;
  })();
  cachedClientPromise = promise;
  cachedClientPromiseConfigKey = configKey;
  promise.catch(() => {
    if (cachedClientPromise === promise) {
      cachedClientPromise = null;
      cachedClientPromiseConfigKey = null;
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
export async function bindArxivRadarProject() {
  const settings = await readAppSettings();
  const workspacePath = requireConductorValue(
    settings.conductor.workspacePath,
    "workspacePath",
  );

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

  const client = await getConductorClient();
  return client.projects.bind({
    name: settings.conductor.appName || "arxiv-radar",
    daemonHost: requireConductorValue(settings.conductor.daemonHost, "daemonHost"),
    workspacePath,
  });
}
