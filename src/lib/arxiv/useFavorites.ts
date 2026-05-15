"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "arxiv-radar:favorites";
const EVENT_NAME = "arxiv-radar:favorites-changed";
const FAVORITES_API = "/api/favorites";

const EMPTY_SNAPSHOT = "[]";
let cachedRaw: string = EMPTY_SNAPSHOT;
let cachedList: string[] = [];
let hydratePromise: Promise<void> | null = null;

function readRawFromStorage(): string {
  if (typeof window === "undefined") {
    return EMPTY_SNAPSHOT;
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? EMPTY_SNAPSHOT;
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function parseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function getSnapshot(): string {
  const raw = readRawFromStorage();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = parseList(raw);
  }

  return cachedRaw;
}

function getServerSnapshot(): string {
  return EMPTY_SNAPSHOT;
}

function subscribe(listener: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  window.addEventListener(EVENT_NAME, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT_NAME, listener);
    window.removeEventListener("storage", listener);
  };
}

function writeToStorage(ids: string[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const next = JSON.stringify(ids);
    window.localStorage.setItem(STORAGE_KEY, next);
    cachedRaw = next;
    cachedList = ids;
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    // ignore quota errors
  }
}

function syncMutationToServer(id: string, op: "add" | "remove") {
  if (typeof window === "undefined") return;

  const path = `${FAVORITES_API}/${encodeURIComponent(id)}`;
  fetch(path, { method: op === "add" ? "POST" : "DELETE", cache: "no-store" }).catch(() => {
    // 网络失败先吃掉；下次 hydrate 时如果是新增方向会被补传，删除方向会留作 known limitation
  });
}

function pushMissingToServer(ids: string[]) {
  for (const id of ids) {
    syncMutationToServer(id, "add");
  }
}

function hydrateFromServer(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    try {
      const response = await fetch(FAVORITES_API, { cache: "no-store" });
      if (!response.ok) return;

      const payload = await response.json();
      const serverIds: string[] = Array.isArray(payload?.favoriteIds)
        ? payload.favoriteIds.filter((id: unknown): id is string => typeof id === "string")
        : [];
      const localIds = parseList(readRawFromStorage());
      const serverSet = new Set(serverIds);
      const union = Array.from(new Set([...serverIds, ...localIds]));

      // 服务器是真理源，但保留本地已有的新增（一次性迁移老 localStorage 数据上云）
      if (
        union.length !== cachedList.length ||
        union.some((id, index) => id !== cachedList[index])
      ) {
        writeToStorage(union);
      }

      const missingOnServer = localIds.filter((id) => !serverSet.has(id));
      pushMissingToServer(missingOnServer);
    } catch {
      // 离线 / 接口挂了：保持 localStorage 当前状态继续用
    }
  })();

  return hydratePromise;
}

export function useFavorites() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    void hydrateFromServer();
  }, []);

  const favorites = useMemo(() => {
    // Re-derive from the cached list when snapshot changes
    void snapshot;
    return new Set(cachedList);
  }, [snapshot]);

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites]);

  const toggleFavorite = useCallback(
    (id: string) => {
      const wasFavorite = favorites.has(id);
      const next = new Set(favorites);
      if (wasFavorite) {
        next.delete(id);
      } else {
        next.add(id);
      }

      writeToStorage(Array.from(next));
      syncMutationToServer(id, wasFavorite ? "remove" : "add");
    },
    [favorites],
  );

  const addFavorite = useCallback(
    (id: string) => {
      if (favorites.has(id)) {
        return;
      }

      const next = new Set(favorites);
      next.add(id);
      writeToStorage(Array.from(next));
      syncMutationToServer(id, "add");
    },
    [favorites],
  );

  return { favorites, isFavorite, toggleFavorite, addFavorite };
}
