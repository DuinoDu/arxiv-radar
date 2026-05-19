"use client";

import type { MouseEvent, ReactNode, SVGProps } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  BrainCircuit,
  ChevronDown,
  Eye,
  FileText,
  Glasses,
  Heart,
  History,
  MessageCircle,
  Plus,
  Tag,
  Radio,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { parseTagFilter, tagLabels, type TagFilter } from "@/lib/arxiv/filters";
import { PAPER_TAGS, type AnalyzedPaper, type ArxivState, type PaperTag, type RunStatus } from "@/lib/arxiv/types";
import { ManualAddButton } from "@/components/arxiv/ManualAddButton";
import { RunAnalysisButton } from "@/components/arxiv/RunAnalysisButton";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useFavorites } from "@/lib/arxiv/useFavorites";

function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.97 3.22 9.18 7.69 10.67.56.1.77-.24.77-.54 0-.27-.01-1.16-.02-2.1-3.13.68-3.79-1.34-3.79-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.94.1-.73.39-1.22.71-1.5-2.5-.28-5.12-1.25-5.12-5.57 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16.9-.25 1.86-.38 2.82-.38.96 0 1.92.13 2.82.38 2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.33-2.62 5.29-5.13 5.56.4.34.76 1.02.76 2.06 0 1.49-.01 2.69-.01 3.06 0 .3.2.65.78.54 4.47-1.49 7.69-5.7 7.69-10.67C23.25 5.48 18.27.5 12 .5Z"
      />
    </svg>
  );
}

const paperTagSet = new Set<string>(PAPER_TAGS);

const tagStyles: Record<PaperTag, string> = {
  egocentric:
    "border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-200",
  vla:
    "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-200",
  world_model:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  so101:
    "border-lime-200 bg-lime-50 text-lime-800 dark:border-lime-900 dark:bg-lime-950/50 dark:text-lime-200",
  vr:
    "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 dark:border-fuchsia-900 dark:bg-fuchsia-950/50 dark:text-fuchsia-200",
  teleop:
    "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-200",
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

const CHAT_STATUS_POLL_MS = 15_000;

type ChatStatusPayload = {
  runningPaperIds?: unknown;
};

function formatDate(value: string | undefined, timeZone: string) {
  if (!value) {
    return "暂无";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
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

function tagCounts(papers: AnalyzedPaper[]) {
  return Object.fromEntries(PAPER_TAGS.map((tag) => [tag, tagCount(papers, tag)])) as Record<PaperTag, number>;
}

function knownPaperTags(tags: readonly string[]) {
  return tags.filter((tag): tag is PaperTag => paperTagSet.has(tag));
}

function arxivHtmlUrl(paper: AnalyzedPaper) {
  return `https://arxiv.org/html/${paper.id}`;
}

function paperChatPath(paper: AnalyzedPaper) {
  return `/papers/${encodeURIComponent(paper.id)}/chat`;
}

function filterHref(filter: TagFilter) {
  return filter === "all" ? "/" : `/?tag=${filter}`;
}

function currentUrlForFilter(filter: TagFilter) {
  const params = new URLSearchParams(window.location.search);

  if (filter === "all") {
    params.delete("tag");
  } else {
    params.set("tag", filter);
  }

  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
}

function MetricPill({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-medium text-zinc-950 dark:text-white">{value}</span>
    </span>
  );
}

function formatTagSource(source: AnalyzedPaper["tagSource"], tag: PaperTag) {
  const value = source?.[tag];

  if (!value) {
    return undefined;
  }

  const labels = {
    title: "标题",
    abstract: "摘要",
    full_text: "正文",
  } as const;

  return labels[value];
}

function TagBadge({
  confidence,
  evidence,
  source,
  tag,
}: {
  confidence?: number;
  evidence?: string;
  source?: string;
  tag: PaperTag;
}) {
  const title = [
    source ? `来源：${source}` : undefined,
    typeof confidence === "number" ? `置信度：${Math.round(confidence * 100)}%` : undefined,
    evidence,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${tagStyles[tag]}`}
      title={title || undefined}
    >
      <Tag className="h-3 w-3" aria-hidden="true" />
      {tagLabels[tag]}
    </span>
  );
}

function EditableTagList({
  tags,
  onChange,
  onDone,
}: {
  tags: PaperTag[];
  onChange: (next: PaperTag[]) => void;
  onDone: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      if (container.contains(event.target as Node)) {
        return;
      }

      onDone();
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onDone();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onDone]);

  const usedSet = new Set(tags);
  const unusedTags = PAPER_TAGS.filter((tag) => !usedSet.has(tag));
  // Keep canonical order so the row doesn't visibly shuffle on each toggle.
  const orderedTags = PAPER_TAGS.filter((tag) => usedSet.has(tag));

  function removeTag(tag: PaperTag) {
    onChange(orderedTags.filter((existing) => existing !== tag));
  }

  function addTag(tag: PaperTag) {
    const next = PAPER_TAGS.filter((candidate) => usedSet.has(candidate) || candidate === tag);
    onChange(next);
    setAddOpen(false);
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label="编辑标签"
      className="flex flex-wrap items-center gap-2 rounded-md bg-zinc-50/70 px-1.5 py-1 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900/40 dark:ring-zinc-800"
    >
      {orderedTags.length === 0 ? (
        <span className="select-none text-xs text-zinc-500 dark:text-zinc-400">
          暂无标签，点击右侧 + 添加
        </span>
      ) : (
        orderedTags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex -translate-y-px items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium shadow-md transition ${tagStyles[tag]}`}
          >
            <Tag className="h-3 w-3" aria-hidden="true" />
            {tagLabels[tag]}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              aria-label={`删除标签 ${tagLabels[tag]}`}
              title={`删除 ${tagLabels[tag]}`}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-current opacity-70 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/15"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            if (unusedTags.length === 0) {
              return;
            }
            setAddOpen((prev) => !prev);
          }}
          disabled={unusedTags.length === 0}
          aria-haspopup="menu"
          aria-expanded={addOpen}
          aria-label="添加标签"
          title={unusedTags.length === 0 ? "已添加全部标签" : "添加标签"}
          className="inline-flex h-6 w-6 -translate-y-px items-center justify-center rounded-full border border-dashed border-zinc-300 bg-white text-zinc-500 shadow-sm transition hover:border-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:border-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>

        {addOpen && unusedTags.length > 0 ? (
          <div
            role="menu"
            className="absolute left-0 top-full z-20 mt-1 flex min-w-[10rem] flex-col gap-0.5 rounded-md border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
          >
            {unusedTags.map((tag) => (
              <button
                key={tag}
                type="button"
                role="menuitem"
                onClick={() => addTag(tag)}
                className="inline-flex items-center gap-2 rounded px-2 py-1 text-left text-xs text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                <Tag className="h-3 w-3" aria-hidden="true" />
                {tagLabels[tag]}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FilterLink({
  active,
  count,
  filter,
  icon,
  label,
  onSelect,
}: {
  active: boolean;
  count: number;
  filter: TagFilter;
  icon: ReactNode;
  label: string;
  onSelect: (filter: TagFilter) => void;
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    event.preventDefault();
    onSelect(filter);
  }

  return (
    <a
      href={filterHref(filter)}
      onClick={handleClick}
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
    </a>
  );
}

function paperCardDomId(id: string) {
  return `paper-card-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function PaperRow({
  paper,
  timeZone,
  chatRunning,
  isFavorite,
  highlighted,
  isEditingTags,
  removePending,
  onToggleFavorite,
  onChatStart,
  onStartTagEdit,
  onCancelTagEdit,
  onTagsChange,
  onRemoveClick,
  onRemoveCancel,
}: {
  paper: AnalyzedPaper;
  timeZone: string;
  chatRunning: boolean;
  isFavorite: boolean;
  highlighted: boolean;
  isEditingTags: boolean;
  removePending: boolean;
  onToggleFavorite: (id: string) => void;
  onChatStart: (id: string) => void;
  onStartTagEdit: (id: string) => void;
  onCancelTagEdit: () => void;
  onTagsChange: (id: string, tags: PaperTag[]) => void;
  onRemoveClick: (id: string) => void;
  onRemoveCancel: () => void;
}) {
  const detailItems = [
    ["假设", paper.hypothesis],
    ["方法", paper.method],
    ["问题", paper.problem],
    ["结论", paper.conclusion],
  ];

  return (
    <article
      id={paperCardDomId(paper.id)}
      className={`rounded-lg border bg-white px-4 py-3 shadow-sm transition dark:bg-zinc-950 ${
        highlighted
          ? "border-amber-400 ring-4 ring-amber-300/70 ring-offset-2 ring-offset-zinc-50 dark:border-amber-400 dark:ring-amber-500/40 dark:ring-offset-zinc-950"
          : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>{paper.id}</span>
            {paper.publishedAt ? <span>{formatDate(paper.publishedAt, timeZone)}</span> : null}
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
            {isEditingTags ? (
              <EditableTagList
                tags={knownPaperTags(paper.tags)}
                onChange={(next) => onTagsChange(paper.id, next)}
                onDone={onCancelTagEdit}
              />
            ) : (
              <div
                onDoubleClick={() => onStartTagEdit(paper.id)}
                title="双击编辑标签"
                className="flex flex-wrap items-center gap-2"
              >
                {knownPaperTags(paper.tags).length === 0 ? (
                  <span className="select-none rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                    双击添加标签
                  </span>
                ) : (
                  knownPaperTags(paper.tags).map((tag) => (
                    <TagBadge
                      key={tag}
                      confidence={paper.tagConfidence?.[tag]}
                      evidence={paper.tagEvidence?.[tag]}
                      source={formatTagSource(paper.tagSource, tag)}
                      tag={tag}
                    />
                  ))
                )}
              </div>
            )}
            <span className="hidden break-words text-sm text-zinc-500 md:inline dark:text-zinc-400">{formatAuthors(paper.authors)}</span>
          </div>

          <div className="mt-2 hidden md:block">
            <p
              className="overflow-hidden break-words text-sm leading-6 text-zinc-700 dark:text-zinc-300"
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
              }}
            >
              {paper.summary}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleFavorite(paper.id)}
            title={isFavorite ? "取消收藏" : "收藏"}
            aria-label={`${paper.title} ${isFavorite ? "取消收藏" : "收藏"}`}
            aria-pressed={isFavorite}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md border transition ${
              isFavorite
                ? "border-rose-300 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-950"
                : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            }`}
          >
            <Heart
              className="h-4 w-4"
              aria-hidden="true"
              fill={isFavorite ? "currentColor" : "none"}
            />
          </button>
          <a
            href={paperChatPath(paper)}
            target="_blank"
            rel="noreferrer"
            onClick={() => onChatStart(paper.id)}
            title={chatRunning ? "chat 运行中" : "chat"}
            aria-label={`${paper.title} chat${chatRunning ? " 运行中" : ""}`}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            {chatRunning ? (
              <span
                className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-zinc-950"
                aria-hidden="true"
              />
            ) : null}
          </a>
          <a
            href={arxivHtmlUrl(paper)}
            target="_blank"
            rel="noreferrer"
            title="HTML 正文"
            aria-label={`${paper.title} HTML 正文`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
          </a>
          {paper.githubUrl ? (
            <a
              href={paper.githubUrl}
              target="_blank"
              rel="noreferrer"
              title="GitHub 代码"
              aria-label={`${paper.title} GitHub 代码`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              <GithubIcon className="h-4 w-4" />
            </a>
          ) : (
            <button
              type="button"
              disabled
              title="未找到 GitHub 链接"
              aria-label={`${paper.title} 未找到 GitHub 链接`}
              className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600"
            >
              <GithubIcon className="h-4 w-4" />
            </button>
          )}
          {removePending ? (
            <button
              type="button"
              onClick={() => onRemoveClick(paper.id)}
              onBlur={onRemoveCancel}
              title="再次点击确认删除"
              aria-label={`${paper.title} 确认删除`}
              className="inline-flex h-9 items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-950"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              remove?
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onRemoveClick(paper.id)}
              title="删除（前端不再显示）"
              aria-label={`${paper.title} 删除`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-zinc-800 dark:text-zinc-200 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <details className="group mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-900">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white">
          <ChevronDown className="h-4 w-4 transition group-open:rotate-180" aria-hidden="true" />
          详情
        </summary>

        <div className="mt-3 space-y-4">
          <div className="space-y-3 md:hidden">
            <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">作者</div>
              <p className="mt-1 break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200">
                {formatAuthors(paper.authors)}
              </p>
            </div>
            <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">简述</div>
              <p className="mt-1 break-words text-sm leading-6 text-zinc-800 dark:text-zinc-200">
                {paper.summary}
              </p>
            </div>
          </div>

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

function RecentRuns({ runs, timeZone }: { runs: ArxivState["runs"]; timeZone: string }) {
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
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{formatDate(run.startedAt, timeZone)}</span>
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

export function PaperDashboard({
  disableManualRun = false,
  initialFilter,
  state,
  timeZone,
}: {
  disableManualRun?: boolean;
  initialFilter: TagFilter;
  state: ArxivState;
  timeZone: string;
}) {
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [focusedPaperId, setFocusedPaperId] = useState<string | null>(null);
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [papers, setPapers] = useState<AnalyzedPaper[]>(state.papers);
  const [papersSource, setPapersSource] = useState<AnalyzedPaper[]>(state.papers);
  const [runningChatPaperIds, setRunningChatPaperIds] = useState<Set<string>>(() => new Set());
  const { favorites, isFavorite, toggleFavorite, addFavorite } = useFavorites();
  const paperListSignature = useMemo(
    () => papers.map((paper) => paper.id).sort().join("|"),
    [papers],
  );

  // Re-sync from server-provided prop when it changes (router.refresh, navigation, etc.).
  // Adjusting state during render is the React-19 endorsed pattern over useEffect.
  if (papersSource !== state.papers) {
    setPapersSource(state.papers);
    setPapers(state.papers);
    setPendingRemoveId(null);
  }

  const handleStartTagEdit = useCallback((paperId: string) => {
    setEditingPaperId(paperId);
  }, []);

  const handleCancelTagEdit = useCallback(() => {
    setEditingPaperId(null);
  }, []);

  const handleTagsChange = useCallback((paperId: string, nextTags: PaperTag[]) => {
    let previousTags: PaperTag[] | null = null;

    setPapers((prev) =>
      prev.map((paper) => {
        if (paper.id !== paperId) {
          return paper;
        }

        previousTags = paper.tags;
        return { ...paper, tags: nextTags };
      }),
    );

    void fetch(`/api/papers/${encodeURIComponent(paperId)}/tags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: nextTags }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({ ok: false }));
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "更新标签失败");
        }
      })
      .catch((error) => {
        console.error("update paper tags failed", error);
        if (previousTags) {
          const tagsToRestore = previousTags;
          setPapers((prev) =>
            prev.map((paper) =>
              paper.id === paperId ? { ...paper, tags: tagsToRestore } : paper,
            ),
          );
        }
      });
  }, []);

  const handleRemoveCancel = useCallback(() => {
    setPendingRemoveId(null);
  }, []);

  const handleRemoveClick = useCallback((paperId: string) => {
    // Two-stage inplace confirm:
    //   1st click → enter pending state (button label becomes "remove?")
    //   2nd click → actually remove the paper from the UI and notify the server.
    setPendingRemoveId((current) => {
      if (current !== paperId) {
        return paperId;
      }

      const removedPaper = papers.find((paper) => paper.id === paperId);

      setPapers((prev) => prev.filter((paper) => paper.id !== paperId));

      void fetch(`/api/papers/${encodeURIComponent(paperId)}/remove`, {
        method: "POST",
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({ ok: false }));
          if (!response.ok || !payload?.ok) {
            throw new Error(payload?.error || "删除论文失败");
          }
        })
        .catch((error) => {
          console.error("remove paper failed", error);
          if (removedPaper) {
            // Roll back the optimistic removal so the user can retry.
            setPapers((prev) =>
              prev.some((paper) => paper.id === paperId)
                ? prev
                : [removedPaper, ...prev],
            );
          }
        });

      return null;
    });
  }, [papers]);

  const lastRun = state.runs[0];
  const lastCompletedRun = state.runs.find((run) => run.status === "completed");
  const countsByTag = useMemo(() => tagCounts(papers), [papers]);
  const favoritesCount = useMemo(
    () => papers.reduce((count, paper) => (favorites.has(paper.id) ? count + 1 : count), 0),
    [favorites, papers],
  );
  const runningChatCount = useMemo(
    () => papers.reduce((count, paper) => (runningChatPaperIds.has(paper.id) ? count + 1 : count), 0),
    [papers, runningChatPaperIds],
  );
  const visiblePapers = useMemo(() => {
    if (activeFilter === "all") {
      return papers;
    }

    if (activeFilter === "favorites") {
      return papers.filter((paper) => favorites.has(paper.id));
    }

    if (activeFilter === "running_chat") {
      return papers.filter((paper) => runningChatPaperIds.has(paper.id));
    }

    return papers.filter((paper) => paper.tags.includes(activeFilter));
  }, [activeFilter, favorites, papers, runningChatPaperIds]);
  const listTitle =
    activeFilter === "all"
      ? "论文列表"
      : activeFilter === "favorites"
        ? "收藏论文"
        : activeFilter === "running_chat"
          ? "chat 论文"
          : `${tagLabels[activeFilter]} 论文`;

  useEffect(() => {
    function handlePopState() {
      setActiveFilter(parseTagFilter(new URLSearchParams(window.location.search).get("tag")));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!paperListSignature) {
      setRunningChatPaperIds(new Set());
      return;
    }

    let cancelled = false;

    async function refreshChatStatus() {
      try {
        const response = await fetch("/api/papers/chat-status", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as ChatStatusPayload;
        if (!response.ok || !Array.isArray(payload.runningPaperIds)) {
          throw new Error("Failed to fetch chat status");
        }

        const nextIds = payload.runningPaperIds.filter(
          (paperId): paperId is string => typeof paperId === "string",
        );
        if (!cancelled) {
          setRunningChatPaperIds(new Set(nextIds));
        }
      } catch (error) {
        console.error("refresh chat status failed", error);
      }
    }

    void refreshChatStatus();
    const interval = window.setInterval(refreshChatStatus, CHAT_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [paperListSignature]);

  useEffect(() => {
    if (!focusedPaperId) {
      return;
    }

    const targetId = focusedPaperId;
    let scrollAttempts = 0;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;

    function tryScroll() {
      const el = document.getElementById(paperCardDomId(targetId));
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      if (scrollAttempts < 5) {
        scrollAttempts += 1;
        scrollTimer = setTimeout(tryScroll, 80);
      }
    }

    tryScroll();

    const clearTimer = setTimeout(() => setFocusedPaperId(null), 2800);

    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [focusedPaperId]);

  function focusExistingPaper(id: string) {
    // 切回 "全部" 保证目标卡片一定可见
    if (activeFilter !== "all") {
      setActiveFilter("all");
      window.history.pushState({ tag: "all" }, "", currentUrlForFilter("all"));
    }
    // 先清空再设置，确保即便是同一个 id 也能重新触发滚动 + 高亮
    setFocusedPaperId(null);
    setTimeout(() => setFocusedPaperId(id), 0);
  }

  function selectFilter(filter: TagFilter) {
    if (filter === activeFilter) {
      setMobileFiltersOpen(false);
      return;
    }

    setActiveFilter(filter);
    setMobileFiltersOpen(false);
    window.history.pushState({ tag: filter }, "", currentUrlForFilter(filter));
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto max-w-7xl px-3 py-2 sm:px-6 md:py-4 lg:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5 md:gap-3">
              <h1 className="truncate text-xl font-semibold tracking-normal text-zinc-950 dark:text-white">arxiv-radar</h1>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen((open) => !open)}
                aria-expanded={mobileFiltersOpen}
                aria-controls="mobile-paper-filters"
                aria-label={mobileFiltersOpen ? "隐藏标签筛选" : "展开标签筛选"}
                title={mobileFiltersOpen ? "隐藏标签筛选" : "展开标签筛选"}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${mobileFiltersOpen ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {lastRun ? (
                <span
                  className={`hidden rounded-full px-2.5 py-1 text-xs font-medium ring-1 md:inline-flex ${statusStyles[lastRun.status]}`}
                >
                  {statusLabels[lastRun.status]}
                </span>
              ) : null}
            </div>

            <div className="hidden items-start gap-3 md:flex">
              <ThemeToggle />
              <ManualAddButton onPaperExists={focusExistingPaper} />
              <RunAnalysisButton disabled={disableManualRun} />
            </div>
          </div>

          <div className="mt-3 hidden flex-wrap gap-2 md:flex">
            <MetricPill label="保存" value={papers.length} />
            <MetricPill label="处理" value={state.processedArticleIds.length} />
            <MetricPill label="上次新增" value={lastCompletedRun ? lastCompletedRun.analyzedCount : 0} />
            <MetricPill label="更新" value={formatDate(state.updatedAt, timeZone)} />
          </div>

          <nav
            id="mobile-paper-filters"
            className={`${mobileFiltersOpen ? "mt-2 flex" : "hidden"} flex-wrap gap-2 md:mt-3 md:flex`}
            aria-label="论文筛选"
          >
            <FilterLink
              active={activeFilter === "all"}
              count={papers.length}
              filter="all"
              icon={<Tag className="h-4 w-4" aria-hidden="true" />}
              label="全部"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "egocentric"}
              count={countsByTag.egocentric}
              filter="egocentric"
              icon={<Eye className="h-4 w-4" aria-hidden="true" />}
              label="egocentric"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "vla"}
              count={countsByTag.vla}
              filter="vla"
              icon={<Workflow className="h-4 w-4" aria-hidden="true" />}
              label="VLA"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "world_model"}
              count={countsByTag.world_model}
              filter="world_model"
              icon={<BrainCircuit className="h-4 w-4" aria-hidden="true" />}
              label="WM"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "so101"}
              count={countsByTag.so101}
              filter="so101"
              icon={<Bot className="h-4 w-4" aria-hidden="true" />}
              label="SO101"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "vr"}
              count={countsByTag.vr}
              filter="vr"
              icon={<Glasses className="h-4 w-4" aria-hidden="true" />}
              label="VR"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "teleop"}
              count={countsByTag.teleop}
              filter="teleop"
              icon={<Radio className="h-4 w-4" aria-hidden="true" />}
              label="teleop"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "favorites"}
              count={favoritesCount}
              filter="favorites"
              icon={
                <Heart
                  className="h-4 w-4"
                  aria-hidden="true"
                  fill={activeFilter === "favorites" ? "currentColor" : "none"}
                />
              }
              label="收藏"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "running_chat"}
              count={runningChatCount}
              filter="running_chat"
              icon={<MessageCircle className="h-4 w-4" aria-hidden="true" />}
              label="chat"
              onSelect={selectFilter}
            />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-3 sm:px-6 md:py-5 lg:px-8">
        <div className="mb-3 hidden items-center justify-between gap-3 md:flex">
          <h2 className="text-lg font-semibold tracking-normal">{listTitle}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {visiblePapers.length} / {papers.length}
          </p>
        </div>

        <section className="space-y-2">
          {visiblePapers.length > 0 ? (
            visiblePapers.map((paper) => (
              <PaperRow
                key={paper.id}
                paper={paper}
                timeZone={timeZone}
                chatRunning={runningChatPaperIds.has(paper.id)}
                isFavorite={isFavorite(paper.id)}
                highlighted={focusedPaperId === paper.id}
                isEditingTags={editingPaperId === paper.id}
                removePending={pendingRemoveId === paper.id}
                onToggleFavorite={toggleFavorite}
                onChatStart={addFavorite}
                onStartTagEdit={handleStartTagEdit}
                onCancelTagEdit={handleCancelTagEdit}
                onTagsChange={handleTagsChange}
                onRemoveClick={handleRemoveClick}
                onRemoveCancel={handleRemoveCancel}
              />
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
              <History className="mx-auto h-8 w-8 text-zinc-400" aria-hidden="true" />
              <h2 className="mt-4 text-base font-semibold">暂无结果</h2>
            </div>
          )}
        </section>

        <RecentRuns runs={state.runs} timeZone={timeZone} />
      </div>
    </main>
  );
}
