import { NextRequest, NextResponse } from "next/server";
import { appTimeZone } from "@/lib/app-settings";
import { AnalysisAlreadyRunningError, runArxivAnalysis } from "@/lib/arxiv/job";
import { listCronUsers, readAppSettings } from "@/lib/arxiv/store";
import type { AppSettings } from "@/lib/arxiv/types";
import { requireAuthSession } from "@/lib/auth/guard";
import { isCronAllowed } from "@/lib/cron-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return authorization === `Bearer ${secret}` || querySecret === secret;
}

function isAutomaticRequest(request: NextRequest) {
  if (request.method !== "GET") return false;

  const params = request.nextUrl.searchParams;
  return !(
    params.get("manual") === "1" ||
    params.get("run") === "1" ||
    params.get("force") === "1" ||
    params.get("reanalyze") === "existing" ||
    params.get("existing") === "1"
  );
}

/**
 * Returns a skip reason only when running is impossible for this user; intent
 * is that *every* trigger (scheduled or manual) processes the configured URL
 * end-to-end so newly published papers can never sit in a "today is done"
 * cooldown window.
 */
function automaticRunSkipReason(settings: AppSettings) {
  if (!settings.cron.enabled) {
    return "auto_fetch_disabled";
  }

  // Users who haven't finished onboarding have no source URL; skip them so the
  // cron doesn't churn through failing runs against an empty URL.
  if (!settings.arxivDailyUrl.trim()) {
    return "not_configured";
  }

  return null;
}

function runOptions(
  request: NextRequest,
  settings: AppSettings,
  trigger: "cron" | "manual",
) {
  return {
    limit: Number(request.nextUrl.searchParams.get("limit") || 100),
    force: request.nextUrl.searchParams.get("force") === "1",
    reanalyzeExisting:
      request.nextUrl.searchParams.get("reanalyze") === "existing" ||
      request.nextUrl.searchParams.get("existing") === "1",
    sourceUrl: settings.arxivDailyUrl,
    trigger,
  };
}

async function handleAutomatic(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await listCronUsers();
  const results = [];

  for (const user of users) {
    // Whitelist gate: non-whitelisted users never run, even if their stored
    // cron_enabled is still true.
    if (!isCronAllowed(user.phone)) {
      results.push({
        userId: user.userId,
        skipped: true,
        reason: "not_whitelisted",
      });
      continue;
    }

    const skipReason = automaticRunSkipReason(user.settings);
    if (skipReason) {
      results.push({
        userId: user.userId,
        skipped: true,
        reason: skipReason,
        cron: {
          enabled: user.settings.cron.enabled,
          localTime: user.settings.cron.localTime,
          timeZone: appTimeZone(),
        },
      });
      continue;
    }

    try {
      const result = await runArxivAnalysis(
        user.userId,
        runOptions(request, user.settings, "cron"),
      );
      results.push({
        userId: user.userId,
        ok: true,
        run: result.run,
        analyzedPaperIds: result.papers.map((paper) => paper.id),
      });
    } catch (error) {
      if (error instanceof AnalysisAlreadyRunningError) {
        results.push({
          userId: user.userId,
          skipped: true,
          reason: "already_running",
          run: error.run,
        });
        continue;
      }
      results.push({
        userId: user.userId,
        ok: false,
        error: (error as Error).message,
      });
    }
  }

  return NextResponse.json({
    ok: results.every((result) => result.ok !== false),
    users: results,
  });
}

async function handleManual(request: NextRequest) {
  const auth = await requireAuthSession();
  if (!auth.ok) return auth.response;

  const userId = auth.session.user.id;
  const settings = await readAppSettings(userId);

  try {
    const result = await runArxivAnalysis(
      userId,
      runOptions(request, settings, "manual"),
    );
    return NextResponse.json({
      ok: true,
      run: result.run,
      analyzedPaperIds: result.papers.map((paper) => paper.id),
    });
  } catch (error) {
    if (error instanceof AnalysisAlreadyRunningError) {
      return NextResponse.json(
        {
          ok: false,
          code: "already_running",
          error: "已有分析任务正在运行",
          run: error.run,
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}

async function handle(request: NextRequest) {
  return isAutomaticRequest(request)
    ? handleAutomatic(request)
    : handleManual(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
