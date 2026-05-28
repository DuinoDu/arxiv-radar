import type { PaperTag, TagConfig } from "./types";

export type TagFilter =
  | PaperTag
  | string
  | "all"
  | "favorites"
  | "running_chat"
  | "killed_chat";

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

const SPECIAL_FILTERS = new Set(["all", "favorites", "running_chat", "killed_chat"]);

export function parseTagFilter(tag?: string | string[] | null, knownTagIds?: ReadonlySet<string>): TagFilter {
  const value = Array.isArray(tag) ? tag[0] : tag;

  if (!value) return "all";

  if (SPECIAL_FILTERS.has(value)) {
    return value as TagFilter;
  }

  if (knownTagIds) {
    return knownTagIds.has(value) ? value : "all";
  }

  // Fallback: accept any non-empty string as a potential tag filter
  return value;
}
