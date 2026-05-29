import { type AppSettings, type TagConfig } from "@/lib/arxiv/types";

/** Default Conductor app name created for a brand-new user. */
export const DEFAULT_CONDUCTOR_APP_NAME = "arxiv-radar-chat";

export interface PublicAppSettings {
  arxivDailyUrl: string;
  autoFetchEnabled: boolean;
  cronLocalTime: string;
  timeZone: string;
  conductorBaseUrl: string;
  conductorToken: string;
  conductorTokenConfigured: boolean;
  conductorDaemonHost: string;
  conductorWorkspacePath: string;
  conductorAppName: string;
  conductorBackendType: string;
  tags: TagConfig[];
}

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cronLocalTimeFromEnv() {
  const hour = Math.min(Math.max(0, Math.floor(numberValue(process.env.ARXIV_RUN_HOUR, 2))), 23);
  const minute = Math.min(Math.max(0, Math.floor(numberValue(process.env.ARXIV_RUN_MINUTE, 0))), 59);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeCronLocalTime(value: unknown, fallback: string) {
  const candidate = stringValue(value, fallback);
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate)) {
    return candidate;
  }
  return fallback;
}

function validateCronLocalTime(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new SettingsValidationError("自动拉取时间必须是 HH:mm 格式");
  }
}

function validateHttpUrl(value: string, fieldName: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SettingsValidationError(`${fieldName} 不是有效 URL`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SettingsValidationError(`${fieldName} 只支持 http 或 https`);
  }
}

export function appTimeZone() {
  return process.env.APP_TIME_ZONE || "Asia/Shanghai";
}

export function createEnvAppSettings(): AppSettings {
  return {
    // New users start with empty settings so the onboarding flow forces an
    // explicit configuration. A deployment may still seed defaults via env.
    arxivDailyUrl: process.env.ARXIV_DAILY_URL?.trim() || "",
    cron: {
      enabled: process.env.ARXIV_AUTO_FETCH_ENABLED !== "0",
      localTime: cronLocalTimeFromEnv(),
    },
    conductor: {
      baseUrl: process.env.CONDUCTOR_BASE_URL?.trim() || "",
      token: process.env.CONDUCTOR_TOKEN?.trim() || "",
      daemonHost: process.env.CONDUCTOR_DAEMON_HOST?.trim() || "",
      workspacePath: process.env.CONDUCTOR_WORKSPACE_PATH?.trim() || "",
      appName: process.env.CONDUCTOR_APP_NAME?.trim() || DEFAULT_CONDUCTOR_APP_NAME,
      backendType: process.env.CONDUCTOR_BACKEND_TYPE?.trim() || "",
    },
    // Empty by default; users define their own tags during onboarding.
    tags: [],
  };
}

/**
 * Whether a user has supplied the minimum settings required to actually use
 * the app: an arXiv source URL to fetch papers and the Conductor daemon host +
 * workspace needed to run paper chats. `baseUrl`/`token` come from the SSO
 * session (no popup field) so they are intentionally excluded here, and
 * `backendType`/`appName`/`tags` are optional.
 */
export function isAppConfigured(settings: AppSettings): boolean {
  return Boolean(
    settings.arxivDailyUrl.trim() &&
      settings.conductor.daemonHost.trim() &&
      settings.conductor.workspacePath.trim(),
  );
}

function normalizeTagConfigs(value: unknown, fallback: TagConfig[]): TagConfig[] {
  if (!Array.isArray(value)) return fallback;
  const seen = new Set<string>();
  const result: TagConfig[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = stringValue(item.id, "").replace(/\s+/g, "_").toLowerCase();
    const label = stringValue(item.label, "");
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, label });
  }
  return result.length > 0 ? result : fallback;
}

export function normalizeAppSettings(
  value: unknown,
  fallback: AppSettings = createEnvAppSettings(),
): AppSettings {
  const root = isRecord(value) ? value : {};
  const cron = isRecord(root.cron) ? root.cron : {};
  const conductor = isRecord(root.conductor) ? root.conductor : {};

  return {
    arxivDailyUrl: stringValue(root.arxivDailyUrl, fallback.arxivDailyUrl) || fallback.arxivDailyUrl,
    cron: {
      enabled: boolValue(cron.enabled, fallback.cron.enabled),
      localTime: normalizeCronLocalTime(cron.localTime, fallback.cron.localTime),
    },
    conductor: {
      baseUrl: stringValue(conductor.baseUrl, fallback.conductor.baseUrl),
      token: stringValue(conductor.token, fallback.conductor.token),
      daemonHost: stringValue(conductor.daemonHost, fallback.conductor.daemonHost),
      workspacePath: stringValue(conductor.workspacePath, fallback.conductor.workspacePath),
      appName: stringValue(conductor.appName, fallback.conductor.appName) || DEFAULT_CONDUCTOR_APP_NAME,
      backendType: stringValue(conductor.backendType, fallback.conductor.backendType),
    },
    tags: normalizeTagConfigs(root.tags, fallback.tags),
  };
}

export function toPublicAppSettings(settings: AppSettings): PublicAppSettings {
  return {
    arxivDailyUrl: settings.arxivDailyUrl,
    autoFetchEnabled: settings.cron.enabled,
    cronLocalTime: settings.cron.localTime,
    timeZone: appTimeZone(),
    conductorBaseUrl: settings.conductor.baseUrl,
    conductorToken: "",
    conductorTokenConfigured: Boolean(settings.conductor.token),
    conductorDaemonHost: settings.conductor.daemonHost,
    conductorWorkspacePath: settings.conductor.workspacePath,
    conductorAppName: settings.conductor.appName,
    conductorBackendType: settings.conductor.backendType,
    tags: settings.tags,
  };
}

export function settingsFromPublicInput(
  input: unknown,
  current: AppSettings,
): AppSettings {
  if (!isRecord(input)) {
    throw new SettingsValidationError("请求体必须是 JSON 对象");
  }

  const arxivDailyUrl = stringValue(input.arxivDailyUrl, current.arxivDailyUrl);
  const cronLocalTime = stringValue(input.cronLocalTime, current.cron.localTime);
  const conductorToken = stringValue(input.conductorToken, "");

  // Allow saving partial progress during onboarding; only validate when set.
  if (arxivDailyUrl) {
    validateHttpUrl(arxivDailyUrl, "arxiv daily 链接");
  }
  validateCronLocalTime(cronLocalTime);

  const conductorBaseUrl = stringValue(input.conductorBaseUrl, current.conductor.baseUrl);
  if (conductorBaseUrl) {
    validateHttpUrl(conductorBaseUrl, "Conductor 地址");
  }

  return {
    arxivDailyUrl,
    cron: {
      enabled: boolValue(input.autoFetchEnabled, current.cron.enabled),
      localTime: cronLocalTime,
    },
    conductor: {
      baseUrl: conductorBaseUrl,
      token: conductorToken || current.conductor.token,
      daemonHost: stringValue(input.conductorDaemonHost, current.conductor.daemonHost),
      workspacePath: stringValue(input.conductorWorkspacePath, current.conductor.workspacePath),
      appName: stringValue(input.conductorAppName, current.conductor.appName) || DEFAULT_CONDUCTOR_APP_NAME,
      backendType: stringValue(input.conductorBackendType, current.conductor.backendType),
    },
    tags: normalizeTagConfigs(input.tags, current.tags),
  };
}

export function requireConductorValue(value: string, key: string) {
  if (!value) {
    throw new Error(
      `Missing Conductor setting ${key}. Configure it from the settings popup or set the matching env var.`,
    );
  }
  return value;
}
