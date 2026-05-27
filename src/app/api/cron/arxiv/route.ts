import { NextRequest, NextResponse } from "next/server";
import { appTimeZone } from "@/lib/app-settings";
import { runArxivAnalysis } from "@/lib/arxiv/job";
import { readAppSettings, readArxivState } from "@/lib/arxiv/store";
import type { AnalysisRun, AppSettings } from "@/lib/arxiv/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return true;
  }

  const authorization = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");

  return authorization === `Bearer ${secret}` || querySecret === secret;
}

function localParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function cronLocalMinutes(localTime: string) {
  const [hour, minute] = localTime.split(":").map((part) => Number.parseInt(part, 10));
  return hour * 60 + minute;
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

function hasRunForScheduledWindow(
  runs: AnalysisRun[],
  settings: AppSettings,
  now: Date,
  timeZone: string,
) {
  const currentLocal = localParts(now, timeZone);
  const scheduledMinutes = cronLocalMinutes(settings.cron.localTime);

  return runs.some((run) => {
    const runLocal = localParts(new Date(run.startedAt), timeZone);
    return (
      runLocal.dateKey === currentLocal.dateKey &&
      runLocal.minutes >= scheduledMinutes &&
      run.sourceUrl === settings.arxivDailyUrl
    );
  });
}

async function automaticRunSkipReason(settings: AppSettings) {
  if (!settings.cron.enabled) {
    return "auto_fetch_disabled";
  }

  const timeZone = appTimeZone();
  const now = new Date();
  const currentLocal = localParts(now, timeZone);
  const scheduledMinutes = cronLocalMinutes(settings.cron.localTime);

  if (currentLocal.minutes < scheduledMinutes) {
    return "not_due";
  }

  const state = await readArxivState();
  if (hasRunForScheduledWindow(state.runs, settings, now, timeZone)) {
    return "already_ran_today";
  }

  return null;
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await readAppSettings();
  const skipReason = isAutomaticRequest(request)
    ? await automaticRunSkipReason(settings)
    : null;

  if (skipReason) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: skipReason,
      cron: {
        enabled: settings.cron.enabled,
        localTime: settings.cron.localTime,
        timeZone: appTimeZone(),
      },
    });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") || 100);
  const force = request.nextUrl.searchParams.get("force") === "1";
  const reanalyzeExisting =
    request.nextUrl.searchParams.get("reanalyze") === "existing" ||
    request.nextUrl.searchParams.get("existing") === "1";

  try {
    const result = await runArxivAnalysis({
      limit,
      force,
      reanalyzeExisting,
      sourceUrl: settings.arxivDailyUrl,
    });
    return NextResponse.json({
      ok: true,
      run: result.run,
      analyzedPaperIds: result.papers.map((paper) => paper.id),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
