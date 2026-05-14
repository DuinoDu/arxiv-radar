"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "arxiv-radar:favorites";
const EVENT_NAME = "arxiv-radar:favorites-changed";

const EMPTY_SNAPSHOT = "[]";
let cachedRaw: string = EMPTY_SNAPSHOT;
let cachedList: string[] = [];

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

export function useFavorites() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const favorites = useMemo(() => {
    // Re-derive from the cached list when snapshot changes
    void snapshot;
    return new Set(cachedList);
  }, [snapshot]);

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites]);

  const toggleFavorite = useCallback(
    (id: string) => {
      const next = new Set(favorites);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      writeToStorage(Array.from(next));
    },
    [favorites],
  );

  return { favorites, isFavorite, toggleFavorite };
}
