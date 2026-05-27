import { NextResponse } from "next/server";
import { readFavoriteIds } from "@/lib/arxiv/store";
import { requireAuthSession } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  try {
    const favoriteIds = await readFavoriteIds();
    return NextResponse.json({ ok: true, favoriteIds });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: (error as Error).message, favoriteIds: [] },
      { status: 500 },
    );
  }
}
