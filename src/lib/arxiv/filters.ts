import type { PaperTag } from "./types";

export type TagFilter = PaperTag | "all" | "favorites";

export const tagLabels: Record<PaperTag, string> = {
  egocentric: "egocentric",
  custom_hardware: "自建采集硬件",
  vla: "VLA",
  world_model: "WM",
};

export function parseTagFilter(tag?: string | string[] | null): TagFilter {
  const value = Array.isArray(tag) ? tag[0] : tag;

  if (
    value === "egocentric" ||
    value === "custom_hardware" ||
    value === "vla" ||
    value === "world_model" ||
    value === "favorites"
  ) {
    return value;
  }

  return "all";
}
