import type { PaperTag } from "./types";

export type TagFilter = PaperTag | "all" | "favorites";

export const tagLabels: Record<PaperTag, string> = {
  egocentric: "egocentric",
  vla: "VLA",
  world_model: "WM",
  so101: "SO101",
  vr: "VR",
};

export function parseTagFilter(tag?: string | string[] | null): TagFilter {
  const value = Array.isArray(tag) ? tag[0] : tag;

  if (
    value === "egocentric" ||
    value === "vla" ||
    value === "world_model" ||
    value === "so101" ||
    value === "vr" ||
    value === "favorites"
  ) {
    return value;
  }

  return "all";
}
