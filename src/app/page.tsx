import { PaperDashboard } from "@/components/arxiv/PaperDashboard";
import { parseTagFilter } from "@/lib/arxiv/filters";
import { getInitialPaperListData } from "@/lib/arxiv/paper-list";
import { readArxivState } from "@/lib/arxiv/store";

export const dynamic = "force-dynamic";

const TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Shanghai";

type SearchParams = {
  tag?: string | string[];
};

export default async function Home({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = await searchParams;
  const initialFilter = parseTagFilter(params?.tag);
  const state = await readArxivState();
  const initialData = getInitialPaperListData(state, initialFilter);

  return (
    <PaperDashboard
      disableManualRun={Boolean(process.env.CRON_SECRET)}
      initialData={initialData}
      initialFilter={initialFilter}
      timeZone={TIME_ZONE}
    />
  );
}
