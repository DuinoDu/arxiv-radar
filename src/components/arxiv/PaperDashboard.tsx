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
  Hand,
  Heart,
  History,
  Map as MapIcon,
  MessageCircle,
  Plus,
  Tag,
  Radio,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { parseTagFilter, tagLabels, type TagFilter } from "@/lib/arxiv/filters";
import {
  PAPER_TAGS,
  type AnalysisRun,
  type AnalyzedPaper,
  type PaperTag,
  type RunStatus,
} from "@/lib/arxiv/types";
import {
  PAPER_LIST_PAGE_SIZE,
  normalizePaperDateKey,
  paperDateKey,
  type PaperCountsByTag,
  type PaperListDateBucket,
  type PaperListInitialData,
  type PaperListPage,
  type PaperListSummary,
} from "@/lib/arxiv/paper-list";
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
  slam:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  umi:
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

const CHAT_STATUS_POLL_MS = 15_000;

type ChatLifecycleStatus = "running" | "killed";

type ChatStatusPayload = {
  runningPaperIds?: unknown;
  killedPaperIds?: unknown;
};

type PaperListPayload = Partial<PaperListPage> & {
  ok?: boolean;
  error?: string;
};

function emptyCountsByTag(): PaperCountsByTag {
  return Object.fromEntries(PAPER_TAGS.map((tag) => [tag, 0])) as PaperCountsByTag;
}

function mergePaperLists(
  current: AnalyzedPaper[],
  incoming: AnalyzedPaper[],
): AnalyzedPaper[] {
  const seen = new Set<string>();
  const merged: AnalyzedPaper[] = [];

  for (const paper of [...current, ...incoming]) {
    if (seen.has(paper.id)) continue;
    seen.add(paper.id);
    merged.push(paper);
  }

  return merged;
}

function sameStringSet(current: ReadonlySet<string>, next: readonly string[]) {
  if (current.size !== next.length) return false;
  return next.every((value) => current.has(value));
}

function knownPaperListPayload(payload: PaperListPayload): payload is PaperListPage {
  return (
    Array.isArray(payload.papers) &&
    typeof payload.total === "number" &&
    typeof payload.offset === "number" &&
    typeof payload.limit === "number" &&
    typeof payload.hasMore === "boolean"
  );
}

function pageEndOffset(page: PaperListPage) {
  return page.offset + page.papers.length;
}

function adjustDateBuckets(
  buckets: readonly PaperListDateBucket[],
  date: string | null,
  delta: number,
): PaperListDateBucket[] {
  if (!date) return buckets.slice();

  const counts = new Map(buckets.map((bucket) => [bucket.date, bucket.count]));
  counts.set(date, Math.max(0, (counts.get(date) ?? 0) + delta));

  return Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([bucketDate, count]) => ({ date: bucketDate, count }));
}

function dateKeyToLocalDate(date: string) {
  const [year, month, day] = date.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function shortDateLabel(date: string) {
  const target = dateKeyToLocalDate(date);
  return `${String(target.getMonth() + 1).padStart(2, "0")}/${String(target.getDate()).padStart(2, "0")}`;
}

function ChatStatusDot({
  className = "",
  status,
}: {
  className?: string;
  status: ChatLifecycleStatus;
}) {
  const color =
    status === "running"
      ? "bg-emerald-500"
      : "bg-zinc-400 dark:bg-zinc-500";

  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${color} ${className}`}
      aria-hidden="true"
    />
  );
}

function chatStatusTitle(status: ChatLifecycleStatus | null) {
  if (status === "running") return "chat 运行中";
  if (status === "killed") return "chat 已停止";
  return "chat";
}

function chatStatusAriaSuffix(status: ChatLifecycleStatus | null) {
  if (status === "running") return " 运行中";
  if (status === "killed") return " 已停止";
  return "";
}

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

function currentUrlForFilter(filter: TagFilter, date?: string | null) {
  const params = new URLSearchParams(window.location.search);

  if (filter === "all") {
    params.delete("tag");
    if (date) {
      params.set("date", date);
    } else {
      params.delete("date");
    }
  } else {
    params.set("tag", filter);
    params.delete("date");
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

function DateFilterBar({
  dates,
  selectedDate,
  onSelect,
}: {
  dates: PaperListDateBucket[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  if (dates.length === 0) {
    return null;
  }

  return (
    <div className="-mx-3 mb-3 overflow-x-auto px-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex min-w-max gap-2 py-1" role="listbox" aria-label="论文日期">
        {dates.map((bucket) => {
          const active = bucket.date === selectedDate;

          return (
            <button
              key={bucket.date}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onSelect(bucket.date)}
              className={`inline-flex h-8 min-w-[4.75rem] items-center justify-between gap-2 rounded-md border px-2.5 text-sm font-medium transition ${
                active
                  ? "border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-zinc-950"
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
              }`}
            >
              <span className="tabular-nums leading-none">
                {shortDateLabel(bucket.date)}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs leading-none ${
                  active
                    ? "bg-white/15 dark:bg-zinc-950/10"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                }`}
              >
                {bucket.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
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
  ariaLabel,
  count,
  filter,
  icon,
  label,
  onSelect,
  title,
}: {
  active: boolean;
  ariaLabel?: string;
  count: number;
  filter: TagFilter;
  icon: ReactNode;
  label: string;
  onSelect: (filter: TagFilter) => void;
  title?: string;
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
      aria-label={ariaLabel}
      title={title}
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
  chatStatus,
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
  chatStatus: ChatLifecycleStatus | null;
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
            title={chatStatusTitle(chatStatus)}
            aria-label={`${paper.title} chat${chatStatusAriaSuffix(chatStatus)}`}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            {chatStatus ? (
              <ChatStatusDot
                status={chatStatus}
                className="absolute right-1 top-1 ring-2 ring-white dark:ring-zinc-950"
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

function RecentRuns({ runs, timeZone }: { runs: AnalysisRun[]; timeZone: string }) {
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
  initialData,
  initialFilter,
  timeZone,
}: {
  disableManualRun?: boolean;
  initialData: PaperListInitialData;
  initialFilter: TagFilter;
  timeZone: string;
}) {
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [focusedPaperId, setFocusedPaperId] = useState<string | null>(null);
  const [editingPaperId, setEditingPaperId] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PaperListSummary>(initialData.summary);
  const [summarySource, setSummarySource] = useState(initialData.summary);
  const [selectedDate, setSelectedDate] = useState<string | null>(initialData.selectedDate);
  const [papers, setPapers] = useState<AnalyzedPaper[]>(initialData.page.papers);
  const [papersSource, setPapersSource] = useState(initialData.page.papers);
  const [listTotal, setListTotal] = useState(initialData.page.total);
  const [hasMorePapers, setHasMorePapers] = useState(initialData.page.hasMore);
  const [nextPageOffset, setNextPageOffset] = useState(() => pageEndOffset(initialData.page));
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runningChatPaperIds, setRunningChatPaperIds] = useState<Set<string>>(() => new Set());
  const [killedChatPaperIds, setKilledChatPaperIds] = useState<Set<string>>(() => new Set());
  const loadSentinelRef = useRef<HTMLDivElement | null>(null);
  const loadRequestSeqRef = useRef(0);
  const { favorites, isFavorite, toggleFavorite, addFavorite } = useFavorites();
  const runningChatFilterIds = useMemo(
    () => Array.from(runningChatPaperIds).filter((paperId) => !killedChatPaperIds.has(paperId)),
    [killedChatPaperIds, runningChatPaperIds],
  );
  const killedChatFilterIds = useMemo(
    () => Array.from(killedChatPaperIds),
    [killedChatPaperIds],
  );

  // Re-sync from server-provided prop when it changes (router.refresh, navigation, etc.).
  // Adjusting state during render is the React-19 endorsed pattern over useEffect.
  if (summarySource !== initialData.summary) {
    setSummarySource(initialData.summary);
    setSummary(initialData.summary);
    setSelectedDate(initialData.selectedDate);
  }

  if (papersSource !== initialData.page.papers) {
    setPapersSource(initialData.page.papers);
    setPapers(initialData.page.papers);
    setListTotal(initialData.page.total);
    setHasMorePapers(initialData.page.hasMore);
    setNextPageOffset(pageEndOffset(initialData.page));
    setLoadError(null);
    setPendingRemoveId(null);
  }

  const loadPaperPage = useCallback(
    async (
      filter: TagFilter,
      options: {
        append?: boolean;
        date?: string | null;
        offset?: number;
        ids?: readonly string[];
      } = {},
    ) => {
      const requestSeq = loadRequestSeqRef.current + 1;
      loadRequestSeqRef.current = requestSeq;
      const append = options.append === true;
      const offset = options.offset ?? 0;
      const params = new URLSearchParams({
        tag: filter,
        offset: String(offset),
        limit: String(PAPER_LIST_PAGE_SIZE),
      });
      const date = filter === "all" ? options.date ?? selectedDate : null;
      const ids =
        options.ids ??
        (filter === "favorites"
          ? Array.from(favorites)
          : filter === "running_chat"
            ? runningChatFilterIds
            : filter === "killed_chat"
              ? killedChatFilterIds
              : undefined);

      if (date) {
        params.set("date", date);
      }

      if (ids?.length) {
        params.set("ids", ids.join(","));
      }

      setLoadingMore(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/papers?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as PaperListPayload;
        if (!response.ok || !knownPaperListPayload(payload)) {
          throw new Error(payload.error || "加载论文失败");
        }
        if (loadRequestSeqRef.current !== requestSeq) return;

        setPapers((current) =>
          append ? mergePaperLists(current, payload.papers) : payload.papers,
        );
        setListTotal(payload.total);
        setHasMorePapers(payload.hasMore);
        setNextPageOffset(pageEndOffset(payload));
      } catch (error) {
        if (loadRequestSeqRef.current === requestSeq) {
          setLoadError((error as Error).message);
        }
      } finally {
        if (loadRequestSeqRef.current === requestSeq) {
          setLoadingMore(false);
        }
      }
    },
    [favorites, killedChatFilterIds, runningChatFilterIds, selectedDate],
  );

  const loadPaperById = useCallback(async (paperId: string) => {
    const params = new URLSearchParams({
      tag: "all",
      id: paperId,
      offset: "0",
      limit: "1",
    });

    const response = await fetch(`/api/papers?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as PaperListPayload;
    if (!response.ok || !knownPaperListPayload(payload) || payload.papers.length === 0) {
      return null;
    }

    return payload.papers[0] ?? null;
  }, []);

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
      if (removedPaper) {
        setListTotal((count) => Math.max(0, count - 1));
        setNextPageOffset((offset) => Math.max(0, offset - 1));
        setSummary((current) => {
          const nextCounts = { ...current.countsByTag };
          for (const tag of removedPaper.tags) {
            nextCounts[tag] = Math.max(0, nextCounts[tag] - 1);
          }
          return {
            ...current,
            totalPapers: Math.max(0, current.totalPapers - 1),
            countsByTag: nextCounts,
            dateBuckets: adjustDateBuckets(
              current.dateBuckets,
              paperDateKey(removedPaper, timeZone),
              -1,
            ),
          };
        });
      }

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
            setListTotal((count) => count + 1);
            setNextPageOffset((offset) => offset + 1);
            setSummary((current) => {
              const nextCounts = { ...current.countsByTag };
              for (const tag of removedPaper.tags) {
                nextCounts[tag] += 1;
              }
              return {
                ...current,
                totalPapers: current.totalPapers + 1,
                countsByTag: nextCounts,
                dateBuckets: adjustDateBuckets(
                  current.dateBuckets,
                  paperDateKey(removedPaper, timeZone),
                  1,
                ),
              };
            });
          }
        });

      return null;
    });
  }, [papers, timeZone]);

  const lastRun = summary.runs[0];
  const lastCompletedRun = summary.runs.find((run) => run.status === "completed");
  const countsByTag = summary.countsByTag ?? emptyCountsByTag();
  const latestPaperDate = summary.dateBuckets[0]?.date ?? null;
  const favoritesCount = favorites.size > 0 ? favorites.size : summary.favoriteCount;
  const runningChatCount = runningChatFilterIds.length;
  const killedChatCount = killedChatFilterIds.length;
  const visiblePapers = useMemo(() => {
    if (activeFilter === "all") {
      return papers;
    }

    if (activeFilter === "favorites") {
      return papers.filter((paper) => favorites.has(paper.id));
    }

    if (activeFilter === "running_chat") {
      return papers.filter(
        (paper) => runningChatPaperIds.has(paper.id) && !killedChatPaperIds.has(paper.id),
      );
    }

    if (activeFilter === "killed_chat") {
      return papers.filter((paper) => killedChatPaperIds.has(paper.id));
    }

    return papers.filter((paper) => paper.tags.includes(activeFilter));
  }, [activeFilter, favorites, killedChatPaperIds, papers, runningChatPaperIds]);
  const listTitle =
    activeFilter === "all"
      ? "论文列表"
      : activeFilter === "favorites"
        ? "收藏论文"
        : activeFilter === "running_chat"
          ? "运行中 chat 论文"
          : activeFilter === "killed_chat"
            ? "已停止 chat 论文"
            : `${tagLabels[activeFilter]} 论文`;

  useEffect(() => {
    function handlePopState() {
      const params = new URLSearchParams(window.location.search);
      const nextFilter = parseTagFilter(params.get("tag"));
      const requestedDate = normalizePaperDateKey(params.get("date"));
      const nextDate =
        nextFilter === "all"
          ? summary.dateBuckets.some((bucket) => bucket.date === requestedDate)
            ? requestedDate
            : latestPaperDate
          : null;
      setActiveFilter(nextFilter);
      setSelectedDate(nextDate);
      void loadPaperPage(nextFilter, { append: false, date: nextDate, offset: 0 });
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [latestPaperDate, loadPaperPage, summary.dateBuckets]);

  useEffect(() => {
    if (summary.totalPapers === 0) {
      setRunningChatPaperIds(new Set());
      setKilledChatPaperIds(new Set());
      return;
    }

    let cancelled = false;

    async function refreshChatStatus() {
      try {
        const response = await fetch("/api/papers/chat-status", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => ({}))) as ChatStatusPayload;
        if (
          !response.ok ||
          !Array.isArray(payload.runningPaperIds) ||
          !Array.isArray(payload.killedPaperIds)
        ) {
          throw new Error("Failed to fetch chat status");
        }

        const nextRunningIds = payload.runningPaperIds.filter(
          (paperId): paperId is string => typeof paperId === "string",
        );
        const nextKilledIds = payload.killedPaperIds.filter(
          (paperId): paperId is string => typeof paperId === "string",
        );
        if (!cancelled) {
          setRunningChatPaperIds((current) =>
            sameStringSet(current, nextRunningIds) ? current : new Set(nextRunningIds),
          );
          setKilledChatPaperIds((current) =>
            sameStringSet(current, nextKilledIds) ? current : new Set(nextKilledIds),
          );
        }
      } catch (error) {
        console.error("refresh chat status failed", error);
      }
    }

    void refreshChatStatus();
    const interval = window.setInterval(refreshChatStatus, CHAT_STATUS_POLL_MS);
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        void refreshChatStatus();
      }
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [summary.totalPapers]);

  useEffect(() => {
    if (activeFilter === "favorites") {
      void loadPaperPage(activeFilter, { append: false, offset: 0 });
      return;
    }

    if (activeFilter !== "running_chat" && activeFilter !== "killed_chat") {
      return;
    }

    void loadPaperPage(activeFilter, { append: false, offset: 0 });
  }, [activeFilter, favorites, killedChatPaperIds, loadPaperPage, runningChatPaperIds]);

  useEffect(() => {
    const sentinel = loadSentinelRef.current;
    if (!sentinel || !hasMorePapers || loadingMore || loadError) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadPaperPage(activeFilter, {
            append: true,
            offset: nextPageOffset,
          });
        }
      },
      { rootMargin: "900px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    activeFilter,
    hasMorePapers,
    loadError,
    loadPaperPage,
    loadingMore,
    nextPageOffset,
  ]);

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

  function switchToAllDate(date: string | null) {
    setActiveFilter("all");
    setSelectedDate(date);
    setMobileFiltersOpen(false);
    setPapers([]);
    setListTotal(0);
    setHasMorePapers(false);
    setNextPageOffset(0);
    setLoadError(null);
    window.history.pushState({ tag: "all", date }, "", currentUrlForFilter("all", date));
    return loadPaperPage("all", { append: false, date, offset: 0 });
  }

  function focusExistingPaper(id: string) {
    // 先清空再设置，确保即便是同一个 id 也能重新触发滚动 + 高亮
    setFocusedPaperId(null);

    void (async () => {
      const existingPaper = papers.find((paper) => paper.id === id);
      const paper = existingPaper ?? await loadPaperById(id);
      const targetDate = paper ? paperDateKey(paper, timeZone) ?? latestPaperDate : latestPaperDate;
      const needsDateSwitch = activeFilter !== "all" || selectedDate !== targetDate;

      if (needsDateSwitch) {
        await switchToAllDate(targetDate);
      }

      if (paper) {
        setPapers((current) => mergePaperLists([paper], current));
      }

      setTimeout(() => setFocusedPaperId(id), 0);
    })();
  }

  function selectPaperDate(date: string) {
    if (date === selectedDate && activeFilter === "all") {
      return;
    }

    void switchToAllDate(date);
  }

  function selectFilter(filter: TagFilter) {
    const nextDate = filter === "all" ? latestPaperDate : null;

    if (filter === activeFilter && (filter !== "all" || selectedDate === nextDate)) {
      setMobileFiltersOpen(false);
      return;
    }

    setActiveFilter(filter);
    setSelectedDate(nextDate);
    setMobileFiltersOpen(false);
    setPapers([]);
    setListTotal(0);
    setHasMorePapers(false);
    setNextPageOffset(0);
    setLoadError(null);
    void loadPaperPage(filter, { append: false, date: nextDate, offset: 0 });
    window.history.pushState({ tag: filter, date: nextDate }, "", currentUrlForFilter(filter, nextDate));
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
            <MetricPill label="保存" value={summary.totalPapers} />
            <MetricPill label="处理" value={summary.processedCount} />
            <MetricPill label="上次新增" value={lastCompletedRun ? lastCompletedRun.analyzedCount : 0} />
            <MetricPill label="更新" value={formatDate(summary.updatedAt, timeZone)} />
          </div>

          <nav
            id="mobile-paper-filters"
            className={`${mobileFiltersOpen ? "mt-2 flex" : "hidden"} flex-wrap gap-2 md:mt-3 md:flex`}
            aria-label="论文筛选"
          >
            <FilterLink
              active={activeFilter === "all"}
              count={summary.totalPapers}
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
              active={activeFilter === "slam"}
              count={countsByTag.slam}
              filter="slam"
              icon={<MapIcon className="h-4 w-4" aria-hidden="true" />}
              label="SLAM"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "umi"}
              count={countsByTag.umi}
              filter="umi"
              icon={<Hand className="h-4 w-4" aria-hidden="true" />}
              label="UMI"
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
              icon={<ChatStatusDot status="running" />}
              ariaLabel="运行中的 chat"
              label="chat"
              title="运行中的 chat"
              onSelect={selectFilter}
            />
            <FilterLink
              active={activeFilter === "killed_chat"}
              count={killedChatCount}
              filter="killed_chat"
              icon={<ChatStatusDot status="killed" />}
              ariaLabel="已停止的 chat"
              label="chat"
              title="已停止的 chat"
              onSelect={selectFilter}
            />
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-3 sm:px-6 md:py-5 lg:px-8">
        <div className="mb-3 hidden items-center justify-between gap-3 md:flex">
          <h2 className="text-lg font-semibold tracking-normal">{listTitle}</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {visiblePapers.length} / {listTotal}
          </p>
        </div>

        {activeFilter === "all" ? (
          <DateFilterBar
            dates={summary.dateBuckets}
            selectedDate={selectedDate}
            onSelect={selectPaperDate}
          />
        ) : null}

        <section className="space-y-2">
          {visiblePapers.length > 0 ? (
            visiblePapers.map((paper) => (
              <PaperRow
                key={paper.id}
                paper={paper}
                timeZone={timeZone}
                chatStatus={
                  killedChatPaperIds.has(paper.id)
                    ? "killed"
                    : runningChatPaperIds.has(paper.id)
                      ? "running"
                      : null
                }
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
          ) : loadingMore ? (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              加载中…
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
              <History className="mx-auto h-8 w-8 text-zinc-400" aria-hidden="true" />
              <h2 className="mt-4 text-base font-semibold">暂无结果</h2>
            </div>
          )}
        </section>

        <div ref={loadSentinelRef} className="h-1" aria-hidden="true" />
        {loadError ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() =>
                loadPaperPage(activeFilter, {
                  append: true,
                  offset: nextPageOffset,
                })
              }
              className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              重试加载
            </button>
          </div>
        ) : loadingMore && visiblePapers.length > 0 ? (
          <div className="mt-3 text-center text-sm text-zinc-500 dark:text-zinc-400">
            加载中…
          </div>
        ) : hasMorePapers ? (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() =>
                loadPaperPage(activeFilter, {
                  append: true,
                  offset: nextPageOffset,
                })
              }
              className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
            >
              加载更多
            </button>
          </div>
        ) : null}

        <RecentRuns runs={summary.runs} timeZone={timeZone} />
      </div>
    </main>
  );
}
