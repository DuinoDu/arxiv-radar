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

  return <PaperDashboard initialFilter={parseTagFilter(params?.tag)} state={state} timeZone={TIME_ZONE} />;
}
