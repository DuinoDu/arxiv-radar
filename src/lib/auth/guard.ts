import { NextResponse } from "next/server";
import { getCurrentAuthSession, type AuthSession } from "@/lib/auth/session";

export function authenticationRequiredResponse() {
  return NextResponse.json(
    { ok: false, error: "请先使用 Conductor 登录", code: "authentication_required" },
    { status: 401 },
  );
}

export async function requireAuthSession(): Promise<
  | { ok: true; session: AuthSession }
  | { ok: false; response: NextResponse }
> {
  const session = await getCurrentAuthSession();
  if (!session) {
    return { ok: false, response: authenticationRequiredResponse() };
  }
  return { ok: true, session };
}
