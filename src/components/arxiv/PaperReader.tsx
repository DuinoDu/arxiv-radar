import Link from "next/link";
import { ArrowLeft, ExternalLink, FileText, Globe2, MessageSquare } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import type { AnalyzedPaper } from "@/lib/arxiv/types";

type ReaderMode = "pdf" | "html";
type WorkspaceView = "pdf" | "html" | "chat";

function arxivHtmlUrl(paper: AnalyzedPaper) {
  return `https://arxiv.org/html/${paper.id}`;
}

function arxivPdfUrl(paper: AnalyzedPaper) {
  return (paper.pdfUrl || `https://arxiv.org/pdf/${paper.id}`).replace(/^http:/, "https:");
}

function chatPath(paper: AnalyzedPaper, view: WorkspaceView) {
  return `/papers/${encodeURIComponent(paper.id)}/chat?view=${view}`;
}

export function PaperReader({ mode, paper }: { mode: ReaderMode; paper: AnalyzedPaper }) {
  const urls = {
    pdf: arxivPdfUrl(paper),
    html: arxivHtmlUrl(paper),
  };
  const currentUrl = urls[mode];

  return (
    <section className="flex h-[calc(100vh-8rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:h-full lg:min-h-0">
      <div className="flex h-11 items-center justify-between gap-2 border-b border-zinc-200 px-2 dark:border-zinc-800">
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/"
            title="论文列表"
            aria-label="论文列表"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <ThemeToggle className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900" />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="inline-flex h-8 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <Link
              href={chatPath(paper, "pdf")}
              scroll={false}
              aria-pressed={mode === "pdf"}
              className={`inline-flex items-center gap-1.5 px-2.5 text-xs font-medium transition ${
                mode === "pdf"
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
                  : "text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              PDF
            </Link>
            <Link
              href={chatPath(paper, "html")}
              scroll={false}
              aria-pressed={mode === "html"}
              className={`inline-flex items-center gap-1.5 border-l border-zinc-200 px-2.5 text-xs font-medium transition dark:border-zinc-800 ${
                mode === "html"
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
                  : "text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              <Globe2 className="h-4 w-4" aria-hidden="true" />
              HTML
            </Link>
            <Link
              href={chatPath(paper, "chat")}
              scroll={false}
              aria-pressed={false}
              className="inline-flex items-center gap-1.5 border-l border-zinc-200 px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-white dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800 lg:hidden"
            >
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Chat
            </Link>
          </div>

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
