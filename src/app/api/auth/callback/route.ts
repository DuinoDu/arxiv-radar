import { NextRequest, NextResponse } from "next/server";
import {
  clearOAuthStateCookie,
  getAppBaseUrl,
  getConductorBaseUrl,
  getConductorSsoClient,
  readOAuthStateCookie,
  setSessionCookie,
  type AuthUser,
} from "@/lib/auth/session";
import { upsertAuthUser } from "@/lib/arxiv/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TokenResponse = {
  access_token?: unknown;
  token_type?: unknown;
  user?: unknown;
  conductor_base_url?: unknown;
  error?: unknown;
  message?: unknown;
};

function redirectWithError(request: NextRequest, code: string) {
  const url = new URL("/", getAppBaseUrl(request));
  url.searchParams.set("auth_error", code);
  return NextResponse.redirect(url);
}

function normalizeUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || !candidate.id.trim()) return null;
  return {
    id: candidate.id,
    email: typeof candidate.email === "string" ? candidate.email : null,
    phone: typeof candidate.phone === "string" ? candidate.phone : null,
    name: typeof candidate.name === "string" ? candidate.name : null,
  };
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = readOAuthStateCookie(request);

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = redirectWithError(request, "invalid_state");
    clearOAuthStateCookie(response, request);
    return response;
  }

  try {
    const { clientId, clientSecret } = getConductorSsoClient();
    const redirectUri = `${getAppBaseUrl(request)}/api/auth/callback`;
    const conductorBaseUrl = getConductorBaseUrl();
    const response = await fetch(`${conductorBaseUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as TokenResponse;

    if (!response.ok) {
      console.warn("[auth] conductor token exchange failed", {
        status: response.status,
        error: payload.error,
        message: payload.message,
      });
      const redirect = redirectWithError(request, "token_exchange_failed");
      clearOAuthStateCookie(redirect, request);
      return redirect;
    }

    const user = normalizeUser(payload.user);
    const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
    if (!user || !accessToken) {
      const redirect = redirectWithError(request, "invalid_token_response");
      clearOAuthStateCookie(redirect, request);
      return redirect;
    }

    const resolvedConductorBaseUrl =
      typeof payload.conductor_base_url === "string"
        ? payload.conductor_base_url.replace(/\/+$/, "")
        : conductorBaseUrl;
    await upsertAuthUser(user, { conductorBaseUrl: resolvedConductorBaseUrl });

    const redirect = NextResponse.redirect(new URL("/", getAppBaseUrl(request)));
    setSessionCookie(redirect, {
      user,
      conductorAccessToken: accessToken,
      conductorBaseUrl: resolvedConductorBaseUrl,
    }, request);
    clearOAuthStateCookie(redirect, request);
    return redirect;
  } catch (error) {
    console.warn("[auth] callback failed", error);
    const response = redirectWithError(request, "callback_failed");
    clearOAuthStateCookie(response, request);
    return response;
  }
}
