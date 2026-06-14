// Cron whitelist: only whitelisted users may enable/use the per-user cron
// (auto-fetch) on the settings page. Everyone else sees it disabled with an
// admin-contact hint, and the cron driver skips them server-side.
//
// Configure via CRON_WHITELIST (comma-separated phone numbers). `*` allows all.
// Defaults to the single allowed user when unset.

export const CRON_NOT_ALLOWED_MESSAGE = "请联系管理员支持此功能";

const DEFAULT_WHITELIST = "18707151525";

function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function cronWhitelist(): string[] {
  const raw = process.env.CRON_WHITELIST ?? DEFAULT_WHITELIST;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * True when the given phone may use cron. Matches by digit-normalized suffix so
 * a stored `+8618707151525` matches a whitelist entry of `18707151525`.
 */
export function isCronAllowed(phone: string | null | undefined): boolean {
  const list = cronWhitelist();
  if (list.includes("*")) return true;

  const digits = normalizePhone(phone);
  if (!digits) return false;

  return list.some((entry) => {
    const candidate = normalizePhone(entry);
    return candidate.length > 0 && (digits === candidate || digits.endsWith(candidate));
  });
}
