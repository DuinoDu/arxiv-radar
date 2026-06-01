import type { PaperTag, TagConfig } from "./types";

export type SystemFilter = "all";
export type ChatStatusFilter = "running_chat" | "killed_chat";
export type FilterToggle = "favorites" | ChatStatusFilter;
export type FilterToken = PaperTag | FilterToggle;
export type TagSelectionFilter = FilterToken[];
export type TagFilter = SystemFilter | TagSelectionFilter;

export const tagLabels: Record<PaperTag, string> = {
  egocentric: "egocentric",
  vla: "VLA",
  world_model: "WM",
  so101: "SO101",
  vr: "VR",
  teleop: "teleop",
  slam: "SLAM",
  umi: "UMI",
  sim: "Sim",
};

export function buildTagLabels(configs: TagConfig[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const config of configs) {
    result[config.id] = config.label;
  }
  return result;
}

const FILTER_TOGGLES = new Set<FilterToggle>(["favorites", "running_chat", "killed_chat"]);
const CHAT_STATUS_FILTERS = new Set<ChatStatusFilter>(["running_chat", "killed_chat"]);

export function parseTagFilter(tag?: string | string[] | null, knownTagIds?: ReadonlySet<string>): TagFilter {
  const values = (Array.isArray(tag) ? tag : tag ? [tag] : [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) return "all";

  if (values.length === 1 && isSystemFilter(values[0])) {
    return values[0];
  }

  const result: PaperTag[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (value === "all") continue;

    if (!isFilterToggle(value) && knownTagIds && !knownTagIds.has(value)) continue;
    if (seen.has(value)) continue;

    seen.add(value);
    result.push(value);
  }

  return result.length > 0 ? result : "all";
}

export function isSystemFilter(value: unknown): value is SystemFilter {
  return value === "all";
}

export function isFilterToggle(value: unknown): value is FilterToggle {
  return typeof value === "string" && FILTER_TOGGLES.has(value as FilterToggle);
}

export function isChatStatusFilter(value: unknown): value is ChatStatusFilter {
  return typeof value === "string" && CHAT_STATUS_FILTERS.has(value as ChatStatusFilter);
}

export function isTagSelectionFilter(filter: TagFilter): filter is TagSelectionFilter {
  return Array.isArray(filter);
}

export function selectedTagIds(filter: TagFilter): PaperTag[] {
  return isTagSelectionFilter(filter)
    ? filter.filter((token): token is PaperTag => !isFilterToggle(token))
    : [];
}

export function selectedChatStatusFilters(filter: TagFilter): ChatStatusFilter[] {
  return isTagSelectionFilter(filter)
    ? filter.filter((token): token is ChatStatusFilter => isChatStatusFilter(token))
    : [];
}

export function filterHasTag(filter: TagFilter, tag: string): boolean {
  return selectedTagIds(filter).includes(tag);
}

export function filterHasToggle(filter: TagFilter, toggle: FilterToggle): boolean {
  return isTagSelectionFilter(filter) && filter.includes(toggle);
}

export function filtersEqual(left: TagFilter, right: TagFilter): boolean {
  if (isSystemFilter(left) || isSystemFilter(right)) {
    return left === right;
  }

  if (left.length !== right.length) {
    return false;
  }

  const rightTags = new Set(right);
  return left.every((tag) => rightTags.has(tag));
}

export function serializeTagFilter(filter: TagFilter): string[] {
  return isTagSelectionFilter(filter) ? filter : filter === "all" ? [] : [filter];
}

function normalizeFilterTokens(tokens: readonly FilterToken[]): TagFilter {
  const result: FilterToken[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (token === "all" || seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }

  return result.length > 0 ? result : "all";
}

export function toggleTagFilter(
  filter: TagFilter,
  tag: string,
  orderedTagIds: readonly string[],
): TagFilter {
  const selected = new Set(selectedTagIds(filter));

  if (selected.has(tag)) {
    selected.delete(tag);
  } else {
    selected.add(tag);
  }

  const orderedSelection = orderedTagIds.filter((candidate) => selected.has(candidate));
  const activeToggles = isTagSelectionFilter(filter)
    ? filter.filter((token): token is FilterToggle => isFilterToggle(token))
    : [];

  return normalizeFilterTokens([...orderedSelection, ...activeToggles]);
}

export function toggleFilterToggle(filter: TagFilter, toggle: FilterToggle): TagFilter {
  const tokens = isTagSelectionFilter(filter) ? [...filter] : [];
  const existingIndex = tokens.indexOf(toggle);

  if (existingIndex >= 0) {
    tokens.splice(existingIndex, 1);
  } else {
    tokens.push(toggle);
  }

  return normalizeFilterTokens(tokens);
}
