import { PAPER_TAGS, type AnalysisRun, type AnalyzedPaper, type ArxivState, type PaperTag } from "./types";
import type { TagFilter } from "./filters";

export const PAPER_LIST_PAGE_SIZE = 40;
export const PAPER_LIST_MAX_PAGE_SIZE = 80;

export type PaperCountsByTag = Record<PaperTag, number>;

export interface PaperListSummary {
  totalPapers: number;
  processedCount: number;
  favoriteCount: number;
  countsByTag: PaperCountsByTag;
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
}

export function getVisiblePapers(state: ArxivState): AnalyzedPaper[] {
  return state.papers.filter((paper) => !paper.removed);
}

export function countPaperTags(papers: readonly AnalyzedPaper[]): PaperCountsByTag {
  return Object.fromEntries(
    PAPER_TAGS.map((tag) => [
      tag,
      papers.reduce((count, paper) => (paper.tags.includes(tag) ? count + 1 : count), 0),
    ]),
  ) as PaperCountsByTag;
}

export function getPaperListSummary(state: ArxivState): PaperListSummary {
  const visiblePapers = getVisiblePapers(state);
  return {
    totalPapers: visiblePapers.length,
    processedCount: state.processedArticleIds.length,
    favoriteCount: state.favoriteIds.length,
    countsByTag: countPaperTags(visiblePapers),
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
  } = {},
): AnalyzedPaper[] {
  let result = papers;

  if (options.paperIds) {
    result = result.filter((paper) => options.paperIds?.has(paper.id));
  }

  if (filter === "all") {
    return result.slice();
  }

  if (filter === "favorites") {
    const favoriteIds = options.paperIds ?? options.favoriteIds ?? new Set<string>();
    return result.filter((paper) => favoriteIds.has(paper.id));
  }

  if (filter === "running_chat" || filter === "killed_chat") {
    return options.paperIds ? result.slice() : [];
  }

  return result.filter((paper) => paper.tags.includes(filter));
}

export function getPaperListPage(
  state: ArxivState,
  filter: TagFilter,
  options: {
    offset?: number;
    limit?: number;
    paperIds?: readonly string[];
  } = {},
): PaperListPage {
  const offset = normalizePageOffset(options.offset);
  const limit = normalizePageLimit(options.limit);
  const favoriteIds = new Set(state.favoriteIds);
  const paperIds = options.paperIds?.length ? new Set(options.paperIds) : undefined;
  const filtered = filterPapers(getVisiblePapers(state), filter, { favoriteIds, paperIds });
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
): PaperListInitialData {
  return {
    summary: getPaperListSummary(state),
    page: getPaperListPage(state, filter, {
      offset: 0,
      limit: PAPER_LIST_PAGE_SIZE,
    }),
  };
}
