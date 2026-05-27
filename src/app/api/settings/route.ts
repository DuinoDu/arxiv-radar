import { NextResponse } from "next/server";
import {
  SettingsValidationError,
  settingsFromPublicInput,
  toPublicAppSettings,
} from "@/lib/app-settings";
import { readAppSettings, updateAppSettings } from "@/lib/arxiv/store";
import { resetConductorClient } from "@/lib/conductor/client";
import { requireAuthSession } from "@/lib/auth/guard";
import type { AppSettings } from "@/lib/arxiv/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function conductorProjectKey(settings: AppSettings) {
  return [
    settings.conductor.baseUrl,
    settings.conductor.daemonHost,
    settings.conductor.workspacePath,
    settings.conductor.appName,
  ].join("\n");
}

export async function GET() {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  const settings = await readAppSettings();
  return NextResponse.json(toPublicAppSettings(settings));
}

export async function PUT(request: Request) {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const current = await readAppSettings();

  try {
    const next = settingsFromPublicInput(body, current);
    const resetPaperTasks = conductorProjectKey(current) !== conductorProjectKey(next);

    await updateAppSettings(next, { resetPaperTasks });
    resetConductorClient();

    return NextResponse.json(toPublicAppSettings(next));
  } catch (error) {
    const status = error instanceof SettingsValidationError ? 400 : 500;
    return NextResponse.json(
      { error: (error as Error).message || "Failed to update settings" },
      { status },
    );
  }
}
