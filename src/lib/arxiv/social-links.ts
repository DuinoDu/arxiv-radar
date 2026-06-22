const X_OR_XHS_HOSTS = new Set([
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "xiaohongshu.com",
  "www.xiaohongshu.com",
  "m.xiaohongshu.com",
  "xhslink.com",
  "www.xhslink.com",
]);

export function normalizeXOrXhsUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") {
    return null;
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!X_OR_XHS_HOSTS.has(host) || url.pathname === "/" || !url.pathname) {
    return null;
  }

  return url.toString();
}
