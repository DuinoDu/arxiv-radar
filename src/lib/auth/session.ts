import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

export const AUTH_SESSION_COOKIE = "arxiv_radar_session";
export const AUTH_STATE_COOKIE = "arxiv_radar_oauth_state";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const STATE_MAX_AGE_SECONDS = 60 * 10;

export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  name?: string | null;
}

export interface AuthSession {
  user: AuthUser;
  conductorAccessToken: string;
  conductorBaseUrl: string;
  expiresAt: string;
}

export type PublicAuthUser = AuthUser;

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url");
}

function sessionSecret() {
  return (
    process.env.ARXIV_AUTH_SECRET ||
    process.env.CONDUCTOR_SSO_CLIENT_SECRET ||
    process.env.CONDUCTOR_TOKEN ||
    "arxiv-radar-dev-session-secret"
  );
}

function encryptionKey() {
  return createHash("sha256").update(sessionSecret()).digest();
}

function secureCookie() {
  const appUrl = process.env.APP_URL ?? "";
  return process.env.NODE_ENV === "production" || appUrl.startsWith("https://");
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax" as const,
    secure: secureCookie(),
  };
}

function encryptSession(session: AuthSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [base64UrlEncode(iv), base64UrlEncode(tag), base64UrlEncode(encrypted)].join(".");
}

function decryptSession(value: string): AuthSession | null {
  const [ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), base64UrlDecode(ivRaw));
    decipher.setAuthTag(base64UrlDecode(tagRaw));
    const decrypted = Buffer.concat([
      decipher.update(base64UrlDecode(encryptedRaw)),
      decipher.final(),
    ]);
    const parsed = JSON.parse(decrypted.toString("utf8")) as Partial<AuthSession>;
    if (
      !parsed.user ||
      typeof parsed.user.id !== "string" ||
      typeof parsed.conductorAccessToken !== "string" ||
      typeof parsed.conductorBaseUrl !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    if (Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return parsed as AuthSession;
  } catch {
    return null;
  }
}

export function createOAuthState() {
  return randomBytes(16).toString("base64url");
}

export function setOAuthStateCookie(response: NextResponse, state: string) {
  response.cookies.set(AUTH_STATE_COOKIE, state, cookieOptions(STATE_MAX_AGE_SECONDS));
}

export function clearOAuthStateCookie(response: NextResponse) {
  response.cookies.set(AUTH_STATE_COOKIE, "", {
    ...cookieOptions(0),
    maxAge: 0,
  });
}

export function readOAuthStateCookie(request: NextRequest) {
  return request.cookies.get(AUTH_STATE_COOKIE)?.value ?? null;
}

export function setSessionCookie(response: NextResponse, input: Omit<AuthSession, "expiresAt">) {
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  response.cookies.set(
    AUTH_SESSION_COOKIE,
    encryptSession({ ...input, expiresAt }),
    cookieOptions(SESSION_MAX_AGE_SECONDS),
  );
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    ...cookieOptions(0),
    maxAge: 0,
  });
}

export async function getCurrentAuthSession(): Promise<AuthSession | null> {
  const store = await cookies();
  const raw = store.get(AUTH_SESSION_COOKIE)?.value;
  return raw ? decryptSession(raw) : null;
}

export async function getCurrentAuthUser(): Promise<PublicAuthUser | null> {
  return (await getCurrentAuthSession())?.user ?? null;
}

export function getAppBaseUrl(request?: NextRequest) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (request) return request.nextUrl.origin.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export function getConductorBaseUrl() {
  const configured = process.env.CONDUCTOR_BASE_URL?.trim();
  if (!configured) {
    throw new Error("Missing CONDUCTOR_BASE_URL");
  }
  return configured.replace(/\/+$/, "");
}

export function getConductorSsoClient() {
  const clientId = process.env.CONDUCTOR_SSO_CLIENT_ID?.trim();
  const clientSecret = process.env.CONDUCTOR_SSO_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing CONDUCTOR_SSO_CLIENT_ID or CONDUCTOR_SSO_CLIENT_SECRET");
  }
  return { clientId, clientSecret };
}
