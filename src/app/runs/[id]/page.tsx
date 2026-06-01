import { notFound } from "next/navigation";
import { RunLogsView } from "@/components/arxiv/RunLogsView";
import { LoginRequired } from "@/components/auth/LoginRequired";
import { findRunForUser, readRunLogs } from "@/lib/arxiv/store";
import { getCurrentAuthUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
};

function decodeRouteId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

const TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Shanghai";

export default async function RunLogsPage({ params }: PageProps) {
  const { id } = await params;
  const runId = decodeRouteId(id);

  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return <LoginRequired />;
  }

  const run = await findRunForUser(authUser.id, runId);
  if (!run) {
    notFound();
  }

  const logs = await readRunLogs(authUser.id, runId);

  return (
    <main className="min-h-[100dvh] bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <RunLogsView run={run} initialLogs={logs} timeZone={TIME_ZONE} />
    </main>
  );
}
