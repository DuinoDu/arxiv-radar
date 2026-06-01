import { PAPER_TAGS, type AnalysisRun, type AnalyzedPaper, type ArxivState, type PaperTag } from "./types";
import {
  filterHasToggle,
  selectedChatStatusFilters,
  selectedTagIds,
  type TagFilter,
} from "./filters";

export const PAPER_LIST_PAGE_SIZE = 40;
export const PAPER_LIST_MAX_PAGE_SIZE = 80;
export const DEFAULT_PAPER_LIST_TIME_ZONE = "UTC";

export type PaperCountsByTag = Record<string, number>;

export interface PaperListDateBucket {
  date: string;
  count: number;
}

export interface PaperListSummary {
  totalPapers: number;
  processedCount: number;
  favoriteCount: number;
  countsByTag: PaperCountsByTag;
  dateBuckets: PaperListDateBucket[];
  runs: AnalysisRun[];
  updatedAt: string;
}

export interface PaperListPage {
  papers: AnalyzedPaper[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface PaperListInitialData {
  summary: PaperListSummary;
  page: PaperListPage;
  selectedDate: string | null;
}

export function getVisiblePapers(state: ArxivState): AnalyzedPaper[] {
  return state.papers.filter((paper) => !paper.removed);
}

export function countPaperTags(
  papers: readonly AnalyzedPaper[],
  tagIds: readonly string[] = PAPER_TAGS,
): PaperCountsByTag {
  return Object.fromEntries(
    tagIds.map((tag) => [
      tag,
      papers.reduce((count, paper) => (paper.tags.includes(tag as PaperTag) ? count + 1 : count), 0),
    ]),
  ) as PaperCountsByTag;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(timeZone);
  if (cached) return cached;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    });
    dateFormatters.set(timeZone, formatter);
    return formatter;
  } catch (error) {
    if (timeZone === DEFAULT_PAPER_LIST_TIME_ZONE) {
      throw error;
    }
    return getDateFormatter(DEFAULT_PAPER_LIST_TIME_ZONE);
  }
}

export function dateValueToPaperDateKey(
  value: Date | string | undefined,
  timeZone = DEFAULT_PAPER_LIST_TIME_ZONE,
): string | null {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = getDateFormatter(timeZone).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : null;
}

export function paperDateKey(
  paper: AnalyzedPaper,
  timeZone = DEFAULT_PAPER_LIST_TIME_ZONE,
): string | null {
  return dateValueToPaperDateKey(
    paper.publishedAt ?? paper.updatedAt ?? paper.analyzedAt,
    timeZone,
  );
}

export function normalizePaperDateKey(value: string | string[] | null | undefined): string | null {
  const date = Array.isArray(value) ? value[0] : value;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  return date;
}

export function getPaperDateBuckets(
  papers: readonly AnalyzedPaper[],
  timeZone = DEFAULT_PAPER_LIST_TIME_ZONE,
): PaperListDateBucket[] {
  const counts = new Map<string, number>();
  for (const paper of papers) {
    const date = paperDateKey(paper, timeZone);
    if (!date) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, count]) => ({ date, count }));
}

export function getPaperListSummary(
  state: ArxivState,
  timeZone = DEFAULT_PAPER_LIST_TIME_ZONE,
  tagIds?: readonly string[],
): PaperListSummary {
  const visiblePapers = getVisiblePapers(state);
  return {
    totalPapers: visiblePapers.length,
    processedCount: state.processedArticleIds.length,
    favoriteCount: state.favoriteIds.length,
    countsByTag: countPaperTags(visiblePapers, tagIds),
    dateBuckets: getPaperDateBuckets(visiblePapers, timeZone),
    runs: state.runs,
    updatedAt: state.updatedAt,
  };
}

export function normalizePageLimit(value: string | number | null | undefined): number {
  const parsed =
    typeof value === "number" ? value : value ? Number.parseInt(value, 10) : PAPER_LIST_PAGE_SIZE;
  if (!Number.isFinite(parsed)) return PAPER_LIST_PAGE_SIZE;
  return Math.min(PAPER_LIST_MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)));
}

export function normalizePageOffset(value: string | number | null | undefined): number {
  const parsed =
    typeof value === "number" ? value : value ? Number.parseInt(value, 10) : 0;
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

export function filterPapers(
  papers: readonly AnalyzedPaper[],
  filter: TagFilter,
  options: {
    favoriteIds?: ReadonlySet<string>;
    paperIds?: ReadonlySet<string>;
    dateKey?: string | null;
    timeZone?: string;
  } = {},
): AnalyzedPaper[] {
  let result = papers;

  if (options.paperIds) {
    result = result.filter((paper) => options.paperIds?.has(paper.id));
  }

  if (options.dateKey) {
    result = result.filter(
      (paper) => paperDateKey(paper, options.timeZone) === options.dateKey,
    );
  }

  if (filter === "all") {
    return result.slice();
  }

  if (filterHasToggle(filter, "favorites")) {
    const favoriteIds = options.favoriteIds ?? new Set<string>();
    result = result.filter((paper) => favoriteIds.has(paper.id));
  }

  if (selectedChatStatusFilters(filter).length > 0 && !options.paperIds) {
    return [];
  }

  const tagIds = selectedTagIds(filter);
  if (tagIds.length === 0) {
    return result.slice();
  }

  return result.filter((paper) => {
    const paperTags = paper.tags as string[];
    return tagIds.every((tag) => paperTags.includes(tag));
  });
}

export function getPaperListPage(
  state: ArxivState,
  filter: TagFilter,
  options: {
    offset?: number;
    limit?: number;
    favoriteIds?: readonly string[];
    paperIds?: readonly string[];
    dateKey?: string | null;
    timeZone?: string;
  } = {},
): PaperListPage {
  const offset = normalizePageOffset(options.offset);
  const limit = normalizePageLimit(options.limit);
  const favoriteIds = new Set(options.favoriteIds ?? state.favoriteIds);
  const paperIds = options.paperIds?.length ? new Set(options.paperIds) : undefined;
  const filtered = filterPapers(getVisiblePapers(state), filter, {
    favoriteIds,
    paperIds,
    dateKey: options.dateKey,
    timeZone: options.timeZone,
  });
  const papers = filtered.slice(offset, offset + limit);

  return {
    papers,
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + papers.length < filtered.length,
  };
}

export function getInitialPaperListData(
  state: ArxivState,
  filter: TagFilter,
  requestedDate?: string | null,
  timeZone = DEFAULT_PAPER_LIST_TIME_ZONE,
  tagIds?: readonly string[],
): PaperListInitialData {
  const summary = getPaperListSummary(state, timeZone, tagIds);
  const normalizedRequestedDate = requestedDate ?? null;
  const selectedDate =
    filter === "all"
      ? summary.dateBuckets.some((bucket) => bucket.date === normalizedRequestedDate)
        ? normalizedRequestedDate
        : summary.dateBuckets[0]?.date ?? null
      : null;

  return {
    summary,
    page: getPaperListPage(state, filter, {
      offset: 0,
      limit: PAPER_LIST_PAGE_SIZE,
      dateKey: selectedDate,
      timeZone,
    }),
    selectedDate,
  };
}
