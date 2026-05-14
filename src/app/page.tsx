import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, Cpu, Eye, FileText, History, MessageCircle, Tag } from "lucide-react";
import { RunAnalysisButton } from "@/components/arxiv/RunAnalysisButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { readArxivState } from "@/lib/arxiv/store";
import type { AnalyzedPaper, PaperTag, RunStatus } from "@/lib/arxiv/types";

export const dynamic = "force-dynamic";

const TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Shanghai";

type TagFilter = PaperTag | "all";

type SearchParams = {
  tag?: string | string[];
};

const tagLabels: Record<PaperTag, string> = {
  egocentric: "egocentric",
  custom_hardware: "自建采集硬件",
};

const tagStyles: Record<PaperTag, string> = {
  egocentric:
    "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-200",
  custom_hardware:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
};

const statusLabels: Record<RunStatus, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
};

const statusStyles: Record<RunStatus, string> = {
  running: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-900",
  completed:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900",
  failed: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900",
};

function formatDate(value?: string) {
  if (!value) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAuthors(authors: string[]) {
  if (authors.length <= 4) {
    return authors.join(", ");
  }

  return `${authors.slice(0, 4).join(", ")} 等 ${authors.length} 人`;
}

function parseFilter(tag?: string | string[]): TagFilter {
  const value = Array.isArray(tag) ? tag[0] : tag;

  if (value === "egocentric" || value === "custom_hardware") {
    return value;
  }

  return "all";
}

function tagCount(papers: AnalyzedPaper[], tag: PaperTag) {
  return papers.filter((paper) => paper.tags.includes(tag)).length;
}

function arxivHtmlUrl(paper: AnalyzedPaper) {
  return `https://arxiv.org/html/${paper.id}`;
}

function paperChatPath(paper: AnalyzedPaper) {
  return `/papers/${encodeURIComponent(paper.id)}/chat`;
}

function MetricPill({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-medium text-zinc-950 dark:text-white">{value}</span>
    </span>
  );
}

function TagBadge({ tag, evidence }: { tag: PaperTag; evidence?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tagStyles[tag]}`}
      title={evidence}
    >
      <Tag className="h-3 w-3" aria-hidden="true" />
      {tagLabels[tag]}
    </span>
  );
}

function FilterLink({
  active,
  count,
  href,
  icon,
  label,
}: {
  active: boolean;
  count: number;
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
        active
          ? "border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-zinc-950"
          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-xs ${
          active ? "bg-white/15 dark:bg-zinc-950/10" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
        }`}
      >
        {count}
      </span>
    </Link>
  );
}

function PaperRow({ paper }: { paper: AnalyzedPaper }) {
  const detailItems = [
    ["假设", paper.hypothesis],
    ["方法", paper.method],
    ["问题", paper.problem],
    ["结论", paper.conclusion],
  ];

  return (
    <article className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{paper.id}</span>
            {paper.publishedAt ? <span>{formatDate(paper.publishedAt)}</span> : null}
            {paper.categories.slice(0, 2).map((category) => (
              <span key={category} className="rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-800">
                {category}
              </span>
            ))}
          </div>

          <h2 className="mt-2 break-words text-base font-semibold leading-6 text-zinc-950 dark:text-white">
            {paper.title}
          </h2>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {paper.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} evidence={paper.tagEvidence[tag]} />
            ))}
            <span className="break-words text-sm text-zinc-500 dark:text-zinc-400">{formatAuthors(paper.authors)}</span>
          </div>

          <p
            className="mt-2 overflow-hidden break-words text-sm leading-6 text-zinc-700 dark:text-zinc-300"
            style={{
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
            }}
          >
            {paper.summary}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href={paperChatPath(paper)}
            title="chat"
            aria-label={`${paper.title} chat`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href={arxivHtmlUrl(paper)}
            target="_blank"
            title="HTML 正文"
            aria-label={`${paper.title} HTML 正文`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <details className="group mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-900">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white">
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
          详情
        </summary>

        <div className="mt-3 space-y-4">
          <dl className="grid gap-3 md:grid-cols-2">
            {detailItems.map(([label, value]) => (
              <div key={label} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</dt>
                <dd className="mt-1 break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200">{value}</dd>
              </div>
            ))}
          </dl>

          <details className="text-sm">
            <summary className="cursor-pointer select-none text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white">
              摘要原文
            </summary>
            <p className="mt-3 break-words rounded-md bg-zinc-50 p-3 leading-7 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {paper.abstract}
            </p>
          </details>

        </div>
      </details>
    </article>
  );
}

function RecentRuns({ runs }: { runs: Awaited<ReturnType<typeof readArxivState>>["runs"] }) {
  if (runs.length === 0) {
    return null;
  }

  return (
    <details className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <summary className="cursor-pointer select-none text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        最近任务
      </summary>
      <div className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-900">
        {runs.slice(0, 5).map((run) => (
          <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${statusStyles[run.status]}`}>
                {statusLabels[run.status]}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{formatDate(run.startedAt)}</span>
            </div>
            <span className="text-sm text-zinc-700 dark:text-zinc-300">
              新增 {run.analyzedCount} / 失败 {run.failedCount}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

export default async function Home({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = await searchParams;
  const activeFilter = parseFilter(params?.tag);
  const state = await readArxivState();
  const papers = state.papers;
  const lastRun = state.runs[0];
  const lastCompletedRun = state.runs.find((run) => run.status === "completed");
  const egocentricCount = tagCount(papers, "egocentric");
  const hardwareCount = tagCount(papers, "custom_hardware");
  const visiblePapers = activeFilter === "all" ? papers : papers.filter((paper) => paper.tags.includes(activeFilter));
  const listTitle = activeFilter === "all" ? "论文列表" : `${tagLabels[activeFilter]} 论文`;

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold tracking-normal text-zinc-950 dark:text-white">arxiv-radar</h1>
              {lastRun ? (
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyles[lastRun.status]}`}
                >
                  {statusLabels[lastRun.status]}
                </span>
              ) : null}
            </div>

            <div className="flex items-start gap-3">
              <ThemeToggle />
              <RunAnalysisButton />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <MetricPill label="保存" value={papers.length} />
            <MetricPill label="处理" value={state.processedArticleIds.length} />
            <MetricPill label="上次新增" value={lastCompletedRun ? lastCompletedRun.analyzedCount : 0} />
            <MetricPill label="更新" value={formatDate(state.updatedAt)} />
          </div>

          <nav className="mt-3 flex flex-wrap gap-2" aria-label="论文筛选">
            <FilterLink
              active={activeFilter === "all"}
              count={papers.length}
              href="/"
              icon={<Tag className="h-4 w-4" aria-hidden="true" />}
              label="全部"
            />
            <FilterLink
              active={activeFilter === "egocentric"}
              count={egocentricCount}
              href="/?tag=egocentric"
              icon={<Eye className="h-4 w-4" aria-hidden="true" />}
              label="egocentric"
            />
            <FilterLink
              active={activeFilter === "custom_hardware"}
              count={hardwareCount}
              href="/?tag=custom_hardware"
              icon={<Cpu className="h-4 w-4" aria-hidden="true" />}
              label="自建采集硬件"
            />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-normal">{listTitle}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {visiblePapers.length} / {papers.length}
          </p>
        </div>

        <section className="space-y-2">
          {visiblePapers.length > 0 ? (
            visiblePapers.map((paper) => <PaperRow key={paper.id} paper={paper} />)
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
              <History className="mx-auto h-8 w-8 text-zinc-400" aria-hidden="true" />
              <h2 className="mt-4 text-base font-semibold">暂无结果</h2>
            </div>
          )}
        </section>

        <RecentRuns runs={state.runs} />
      </div>
    </main>
  );
}
