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
 */
export async function bindArxivRadarProject() {
  const client = await getConductorClient();
  return client.projects.bind({
    name: process.env.CONDUCTOR_APP_NAME ?? "arxiv-radar",
    daemonHost: readEnv("CONDUCTOR_DAEMON_HOST"),
    workspacePath: readEnv("CONDUCTOR_WORKSPACE_PATH"),
  });
}
