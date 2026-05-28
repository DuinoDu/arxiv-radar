import { NextRequest, NextResponse } from "next/server";
import {
  createOAuthState,
  getAppBaseUrl,
  getConductorBaseUrl,
  getConductorSsoClient,
  setOAuthStateCookie,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const state = createOAuthState();
    const { clientId } = getConductorSsoClient();
    const redirectUri = `${getAppBaseUrl(request)}/api/auth/callback`;
    const authorizeUrl = new URL(`${getConductorBaseUrl()}/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("state", state);

    const response = NextResponse.redirect(authorizeUrl);
    setOAuthStateCookie(response, state, request);
    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
