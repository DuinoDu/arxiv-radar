import { PaperDashboard } from "@/components/arxiv/PaperDashboard";
import { parseTagFilter } from "@/lib/arxiv/filters";
import { readArxivState } from "@/lib/arxiv/store";

export const dynamic = "force-dynamic";

const TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Shanghai";

type SearchParams = {
  tag?: string | string[];
};

export default async function Home({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = await searchParams;
  const state = await readArxivState();
  // Papers flagged `removed` stay in storage (so the next analysis run won't
  // re-add them via processedArticleIds dedupe), but they must never reach the
  // UI — strip them here so counts / filters / list all match what's visible.
  const visibleState = {
    ...state,
    papers: state.papers.filter((paper) => !paper.removed),
  };

  return (
    <PaperDashboard
      disableManualRun={Boolean(process.env.CRON_SECRET)}
      initialFilter={parseTagFilter(params?.tag)}
      state={visibleState}
      timeZone={TIME_ZONE}
    />
  );
}
