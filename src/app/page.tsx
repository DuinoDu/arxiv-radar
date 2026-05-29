import { PaperDashboard } from "@/components/arxiv/PaperDashboard";
import { LoginRequired } from "@/components/auth/LoginRequired";
import { isAppConfigured } from "@/lib/app-settings";
import { parseTagFilter } from "@/lib/arxiv/filters";
import { getInitialPaperListData, normalizePaperDateKey } from "@/lib/arxiv/paper-list";
import { readAppSettings, readArxivState } from "@/lib/arxiv/store";
import { getCurrentAuthUser, getLoginPath } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Shanghai";

type SearchParams = {
  date?: string | string[];
  tag?: string | string[];
};

export default async function Home({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = await searchParams;
  const initialDate = normalizePaperDateKey(params?.date);
  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return <LoginRequired />;
  }

  const [state, settings] = await Promise.all([
    readArxivState(authUser.id),
    readAppSettings(authUser.id),
  ]);
  const needsSetup = !isAppConfigured(settings);
  const tagConfigs = settings.tags;
  const tagIds = new Set(tagConfigs.map((t) => t.id));
  const initialFilter = parseTagFilter(params?.tag, tagIds);
  const initialData = getInitialPaperListData(
    state,
    initialFilter,
    initialDate,
    TIME_ZONE,
    tagConfigs.map((t) => t.id),
  );

  return (
    <PaperDashboard
      authUser={authUser}
      disableManualRun={Boolean(process.env.CRON_SECRET)}
      initialData={initialData}
      initialFilter={initialFilter}
      loginHref={getLoginPath()}
      needsSetup={needsSetup}
      tagConfigs={tagConfigs}
      timeZone={TIME_ZONE}
    />
  );
}
