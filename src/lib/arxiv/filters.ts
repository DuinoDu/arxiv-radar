import type { PaperTag } from "./types";

export type TagFilter =
  | PaperTag
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
};

export function parseTagFilter(tag?: string | string[] | null): TagFilter {
  const value = Array.isArray(tag) ? tag[0] : tag;

  if (
    value === "egocentric" ||
    value === "vla" ||
    value === "world_model" ||
    value === "so101" ||
    value === "vr" ||
    value === "teleop" ||
    value === "slam" ||
    value === "umi" ||
    value === "favorites" ||
    value === "running_chat" ||
    value === "killed_chat"
  ) {
    return value;
  }

  return "all";
}
