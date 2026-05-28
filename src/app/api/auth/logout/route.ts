import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { clearSessionCookie, getCurrentAuthSession } from "@/lib/auth/session";
import { releaseConductorSessionClient } from "@/lib/conductor/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getCurrentAuthSession();
  if (session) {
    await releaseConductorSessionClient(session);
  }
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response, request);
  return response;
}
