import { PaperDashboard } from "@/components/arxiv/PaperDashboard";
import { parseTagFilter } from "@/lib/arxiv/filters";
import { getInitialPaperListData, normalizePaperDateKey } from "@/lib/arxiv/paper-list";
import { readArxivState } from "@/lib/arxiv/store";
import { getCurrentAuthUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Shanghai";

type SearchParams = {
  date?: string | string[];
  tag?: string | string[];
};

export default async function Home({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = await searchParams;
  const initialFilter = parseTagFilter(params?.tag);
  const initialDate = normalizePaperDateKey(params?.date);
  const state = await readArxivState();
  const authUser = await getCurrentAuthUser();
  const initialData = getInitialPaperListData(state, initialFilter, initialDate, TIME_ZONE);

  return (
    <PaperDashboard
      authUser={authUser}
      disableManualRun={Boolean(process.env.CRON_SECRET)}
      initialData={initialData}
      initialFilter={initialFilter}
      timeZone={TIME_ZONE}
    />
  );
}
