/**
 * GET /api/auth/dev-login
 *
 * Local-only login bypass. Mints an `arxiv_radar_session` cookie directly,
 * skipping the Conductor SSO OAuth dance, then redirects home so the very
 * next render is authenticated.
 *
 * Double-gated so it can never become a production backdoor:
 *   1. `NODE_ENV !== "production"`, AND
 *   2. `DEV_AUTH_BYPASS === "1"` (explicit opt-in).
 * When either gate is closed the route 404s — indistinguishable from "route
 * doesn't exist".
 *
 * Conductor-backed features (chat bind / chat-status / the chat widget) only
 * work when `conductorAccessToken` is a *real* Conductor user token — set
 * `CONDUCTOR_TOKEN` in `.env.local` for that. Without it the dashboard, paper
 * list, favorites, tag editing and remove still work for pure UI development;
 * the chat calls will just 401 against Conductor.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  getAppBaseUrl,
  isDevAuthBypassEnabled,
  setSessionCookie,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isDevAuthBypassEnabled()) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const response = NextResponse.redirect(getAppBaseUrl(request));
  setSessionCookie(
    response,
    {
      user: {
        id:
          process.env.DEV_USER_ID?.trim() ||
          process.env.ARXIV_USER_ID?.trim() ||
          "dev-user",
        email: process.env.DEV_USER_EMAIL?.trim() || "dev@localhost",
        phone: null,
        name: "Dev User",
      },
      // Real Conductor user token → chat works too. Falls back to a placeholder
      // that's good enough to pass the auth gate for UI-only development.
      conductorAccessToken: process.env.CONDUCTOR_TOKEN?.trim() || "dev-bypass-token",
      conductorBaseUrl:
        process.env.CONDUCTOR_BASE_URL?.trim().replace(/\/+$/, "") ||
        "http://localhost",
    },
    request,
  );
  return response;
}
