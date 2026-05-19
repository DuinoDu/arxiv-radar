/**
 * Conductor App SDK client singleton.
 *
 * One `AppClient` is shared across all Next.js Route Handlers in the same
 * Node process. The first call to `getClient()` opens a `/ws/app` WebSocket;
 * subsequent calls reuse it.
 *
 * TODO(account-system): credentials currently come from process-wide env
 * vars and the client is a process singleton. When the app gains a per-user
 * account system:
 *   - move baseUrl / token / daemonHost / workspacePath onto the user
 *     profile and let users configure them from a settings page (validate
 *     via `client.projects.bind()` on save);
 *   - change `getClient()` to `getClient(userId)` backed by an LRU cache so
 *     each user's Conductor session is isolated;
 *   - keep the env-var path as the fallback for the unauthenticated /
 *     local-dev case.
 */
import { promises as fs } from "node:fs";
import { connect, type AppClient } from "@love-moon/app-sdk/server";

let cachedClient: AppClient | null = null;
let cachedClientPromise: Promise<AppClient> | null = null;

function readEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing env var ${key}. See .env.example for the full list of Conductor settings.`,
    );
  }
  return value;
}

export async function getConductorClient(): Promise<AppClient> {
  if (cachedClient) return cachedClient;
  if (cachedClientPromise) return cachedClientPromise;

  // Cache the *promise* so concurrent callers share one connect; clear the
  // cache on failure so the next caller retries from scratch instead of
  // re-receiving the same rejection forever.
  const promise = (async () => {
    const client = await connect({
      baseUrl: readEnv("CONDUCTOR_BASE_URL"),
      bearerToken: readEnv("CONDUCTOR_TOKEN"),
      onUnauthorized: () => {
        console.error(
          "[conductor] 401 from Conductor — token invalid or revoked?",
        );
      },
    });
    cachedClient = client;
    return client;
  })();
  cachedClientPromise = promise;
  promise.catch(() => {
    if (cachedClientPromise === promise) {
      cachedClientPromise = null;
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
  const workspacePath = readEnv("CONDUCTOR_WORKSPACE_PATH");

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
    name: process.env.CONDUCTOR_APP_NAME ?? "arxiv-radar",
    daemonHost: readEnv("CONDUCTOR_DAEMON_HOST"),
    workspacePath,
  });
}
