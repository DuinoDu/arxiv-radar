import Link from "next/link";
import {
  CalendarClock,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  FileText,
  History,
  Tag,
} from "lucide-react";
import { RunAnalysisButton } from "@/components/arxiv/RunAnalysisButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { readArxivState } from "@/lib/arxiv/store";
import type { AnalyzedPaper, PaperTag, RunStatus } from "@/lib/arxiv/types";

export const dynamic = "force-dynamic";

const TIME_ZONE = process.env.APP_TIME_ZONE || "Asia/Shanghai";

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

function tagCount(papers: AnalyzedPaper[], tag: PaperTag) {
  return papers.filter((paper) => paper.tags.includes(tag)).length;
}

function StatBlock({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-normal text-zinc-950 dark:text-white">{value}</p>
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{detail}</p>
    </div>
  );
}

function PaperCard({ paper }: { paper: AnalyzedPaper }) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{paper.id}</span>
            {paper.publishedAt ? <span>{formatDate(paper.publishedAt)}</span> : null}
            {paper.categories.slice(0, 3).map((category) => (
              <span key={category} className="rounded border border-zinc-200 px-1.5 py-0.5 dark:border-zinc-800">
                {category}
              </span>
            ))}
          </div>
          <h2 className="mt-2 break-words text-lg font-semibold leading-7 text-zinc-950 dark:text-white">
            {paper.title}
          </h2>
          <p className="mt-1 break-words text-sm text-zinc-500 dark:text-zinc-400">{formatAuthors(paper.authors)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={paper.arxivUrl}
            target="_blank"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            arXiv
          </Link>
          {paper.pdfUrl ? (
            <Link
              href={paper.pdfUrl}
              target="_blank"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-200 px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              PDF
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {paper.tags.length > 0 ? (
          paper.tags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${tagStyles[tag]}`}
              title={paper.tagEvidence[tag]}
            >
              <Tag className="h-3.5 w-3.5" aria-hidden="true" />
              {tagLabels[tag]}
            </span>
          ))
        ) : (
          <span className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            未命中特殊标签
          </span>
        )}
      </div>

      <p className="mt-4 break-words text-base leading-7 text-zinc-900 dark:text-zinc-100">{paper.summary}</p>

      <dl className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Hypothesis</dt>
          <dd className="mt-1 break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200">{paper.hypothesis}</dd>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Method</dt>
          <dd className="mt-1 break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200">{paper.method}</dd>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Problem</dt>
          <dd className="mt-1 break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200">{paper.problem}</dd>
        </div>
        <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <dt className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Conclusion</dt>
          <dd className="mt-1 break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200">{paper.conclusion}</dd>
        </div>
      </dl>

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer select-none text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white">
          摘要原文
        </summary>
        <p className="mt-3 break-words rounded-md bg-zinc-50 p-3 leading-7 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {paper.abstract}
        </p>
      </details>
    </article>
  );
}

export default async function Home() {
  const state = await readArxivState();
  const papers = state.papers;
  const lastRun = state.runs[0];
  const lastCompletedRun = state.runs.find((run) => run.status === "completed");
  const egocentricCount = tagCount(papers, "egocentric");
  const hardwareCount = tagCount(papers, "custom_hardware");

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-normal text-zinc-950 dark:text-white">
                  arxiv-radar
                </h1>
                {lastRun ? (
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusStyles[lastRun.status]}`}
                  >
                    {statusLabels[lastRun.status]}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                每天 00:00（{TIME_ZONE}）抓取 arXiv cs.RO recent 前 100 篇，跳过已经处理过的 arXiv ID。
              </p>
            </div>
            <div className="flex items-start gap-3">
              <ThemeToggle />
              <RunAnalysisButton />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <StatBlock
              icon={<Database className="h-5 w-5" aria-hidden="true" />}
              label="已处理论文"
              value={state.processedArticleIds.length}
              detail={state.runs.length > 0 ? `本地状态更新：${formatDate(state.updatedAt)}` : "等待首次任务写入状态"}
            />
            <StatBlock
              icon={<Eye className="h-5 w-5" aria-hidden="true" />}
              label="Egocentric"
              value={egocentricCount}
              detail="标题或摘要涉及第一视角、头戴式或自我中心感知。"
            />
            <StatBlock
              icon={<Cpu className="h-5 w-5" aria-hidden="true" />}
              label="自建采集硬件"
              value={hardwareCount}
              detail="明确自研用于数据采集的设备、传感器或 rig。"
            />
            <StatBlock
              icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
              label="上次完成"
              value={lastCompletedRun ? lastCompletedRun.analyzedCount : 0}
              detail={lastCompletedRun ? formatDate(lastCompletedRun.finishedAt) : "还没有完成过分析任务"}
            />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[1fr_320px] lg:px-8">
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-normal">论文列表</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{papers.length} 篇已保存</p>
          </div>

          {papers.length > 0 ? (
            papers.map((paper) => <PaperCard key={paper.id} paper={paper} />)
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
              <History className="mx-auto h-8 w-8 text-zinc-400" aria-hidden="true" />
              <h2 className="mt-4 text-base font-semibold">暂无分析结果</h2>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                配置环境变量后点击“立即分析”，或等待每日定时任务写入结果。
              </p>
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <h2 className="text-sm font-semibold tracking-normal">最近任务</h2>
            <div className="mt-4 space-y-3">
              {state.runs.slice(0, 8).map((run) => (
                <div key={run.id} className="border-b border-zinc-100 pb-3 last:border-0 last:pb-0 dark:border-zinc-900">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${statusStyles[run.status]}`}>
                      {statusLabels[run.status]}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(run.startedAt)}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                    抓取 {run.fetchedCount}，跳过 {run.skippedAlreadyProcessedCount}，新增 {run.analyzedCount}，失败{" "}
                    {run.failedCount}
                  </p>
                  {run.message ? (
                    <p className="mt-1 break-words text-xs text-red-600 dark:text-red-400">{run.message}</p>
                  ) : null}
                </div>
              ))}
              {state.runs.length === 0 ? (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无任务记录</p>
              ) : null}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
