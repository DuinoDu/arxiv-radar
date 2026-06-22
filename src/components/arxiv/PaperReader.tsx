import Link from "next/link";
import { ArrowLeft, ExternalLink, FileText, Globe2, MessageSquare } from "lucide-react";
import { PaperGithubButton, PaperXButton } from "@/components/arxiv/PaperLinkButtons";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { paperHtmlUrl, paperPdfUrl } from "@/lib/arxiv/paper-source";
import type { AnalyzedPaper } from "@/lib/arxiv/types";

type ReaderMode = "pdf" | "html";
type WorkspaceView = "pdf" | "html" | "chat";

function chatPath(paper: AnalyzedPaper, view: WorkspaceView) {
  return `/papers/${encodeURIComponent(paper.id)}/chat?view=${view}`;
}

export function PaperReader({
  mode,
  paper,
  onGithubUrlChange,
  onXUrlChange,
}: {
  mode: ReaderMode;
  paper: AnalyzedPaper;
  onGithubUrlChange: (id: string, githubUrl: string) => void;
  onXUrlChange: (id: string, xUrl: string) => void;
}) {
  const urls = {
    pdf: paperPdfUrl(paper),
    html: paperHtmlUrl(paper),
  };
  const currentUrl = mode === "html" && urls.html ? urls.html : urls.pdf;

  return (
    <section className="flex h-[100dvh] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:h-full lg:min-h-0">
      <div className="relative z-20 flex h-11 items-center justify-between gap-2 border-b border-zinc-200 px-2 dark:border-zinc-800">
        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Intentional hard navigation: ensure clicking back lands on a
              fresh `/` instead of restoring the previous router/scroll state. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            title="论文列表"
            aria-label="论文列表"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </a>
          <ThemeToggle className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900" />
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Tab group: icon-only on mobile (text label hidden), icon + text
              on desktop. Padding tightens on mobile to keep the group from
              fighting other top-bar items for space. */}
          <div className="inline-flex h-8 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <Link
              href={chatPath(paper, "pdf")}
              scroll={false}
              aria-pressed={mode === "pdf"}
              aria-label="PDF"
              title="PDF"
              className={`inline-flex w-8 items-center justify-center text-xs font-medium transition lg:w-auto lg:gap-1.5 lg:px-2.5 ${
                mode === "pdf"
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
                  : "text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span className="hidden lg:inline">PDF</span>
            </Link>
            {urls.html ? (
              <Link
                href={chatPath(paper, "html")}
                scroll={false}
                aria-pressed={mode === "html"}
                aria-label="HTML"
                title="HTML"
                className={`inline-flex w-8 items-center justify-center border-l border-zinc-200 text-xs font-medium transition dark:border-zinc-800 lg:w-auto lg:gap-1.5 lg:px-2.5 ${
                  mode === "html"
                    ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
                    : "text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                <Globe2 className="h-4 w-4" aria-hidden="true" />
                <span className="hidden lg:inline">HTML</span>
              </Link>
            ) : null}
            <Link
              href={chatPath(paper, "chat")}
              scroll={false}
              aria-pressed={false}
              aria-label="Chat"
              title="Chat"
              className="inline-flex w-8 items-center justify-center border-l border-zinc-200 text-zinc-600 transition hover:bg-white dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 lg:hidden"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>

          <PaperGithubButton
            paperId={paper.id}
            paperTitle={paper.title}
            githubUrl={paper.githubUrl}
            onSubmit={onGithubUrlChange}
            buttonClassName="h-8 w-8"
          />
          <PaperXButton
            paperId={paper.id}
            paperTitle={paper.title}
            xUrl={paper.xUrl}
            onSubmit={onXUrlChange}
            buttonClassName="h-8 w-8"
          />

          <Link
            href={currentUrl}
            target="_blank"
            title="打开原文"
            aria-label="打开原文"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <iframe
        key={currentUrl}
        src={currentUrl}
        title={`${paper.title} ${mode.toUpperCase()}`}
        className="h-full min-h-0 w-full flex-1 bg-white"
      />
    </section>
  );
}
