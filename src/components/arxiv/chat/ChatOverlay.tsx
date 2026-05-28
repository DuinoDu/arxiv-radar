"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ChevronDown, Copy, Check } from "lucide-react";

/**
 * Overlay layer rendered on top of the SDK ChatView.
 *
 * Provides three features the base widget doesn't ship:
 *  1. Scroll-to-bottom button when the user scrolls up
 *  2. "N 条新消息" anchor when new messages arrive while scrolled up
 *  3. Double-click on a bubble → bottom action-sheet (copy)
 *
 * The overlay attaches DOM listeners to the `.conductor-message-list`
 * element inside the wrapper ref.
 */
export function ChatOverlay({
  wrapperRef,
}: {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Keep a stable reference to the message-list element.
  const listElRef = useRef<HTMLElement | null>(null);

  const getListEl = useCallback((): HTMLElement | null => {
    if (listElRef.current) return listElRef.current;
    const el = wrapperRef.current?.querySelector(".conductor-message-list");
    if (el) listElRef.current = el as HTMLElement;
    return listElRef.current;
  }, [wrapperRef]);

  // ---------- Scroll tracking ----------
  useEffect(() => {
    // Delay briefly so the ChatView has time to mount its DOM.
    const timer = setTimeout(() => {
      const el = getListEl();
      if (!el) return;

      function handleScroll() {
        const list = el!;
        const distanceFromBottom =
          list.scrollHeight - list.scrollTop - list.clientHeight;
        const scrolledUp = distanceFromBottom > 200;
        setIsScrolledUp(scrolledUp);
        if (!scrolledUp) setNewMessageCount(0);
      }

      el.addEventListener("scroll", handleScroll, { passive: true });
      // Run once to capture initial state.
      handleScroll();

      // Store cleanup in a ref-safe closure.
      cleanupRef.current = () =>
        el.removeEventListener("scroll", handleScroll);
    }, 100);

    const cleanupRef = { current: () => {} };
    return () => {
      clearTimeout(timer);
      cleanupRef.current();
    };
  }, [getListEl]);

  // ---------- New-message detection via MutationObserver ----------
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = getListEl();
      if (!el) return;

      const observer = new MutationObserver(() => {
        const distanceFromBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom > 200) {
          setNewMessageCount((n) => n + 1);
        }
      });

      observer.observe(el, { childList: true });
      cleanupRef.current = () => observer.disconnect();
    }, 100);

    const cleanupRef = { current: () => {} };
    return () => {
      clearTimeout(timer);
      cleanupRef.current();
    };
  }, [getListEl]);

  // ---------- Double-click → action-sheet ----------
  useEffect(() => {
    const timer = setTimeout(() => {
      const el = getListEl();
      if (!el) return;

      function handleDblClick(e: Event) {
        const target = e.target as HTMLElement;
        const bubble = target.closest(".conductor-bubble");
        if (!bubble) return;
        e.preventDefault();
        const text = bubble.textContent ?? "";
        if (text) {
          setSelectedText(text);
          setCopied(false);
        }
      }

      el.addEventListener("dblclick", handleDblClick);
      cleanupRef.current = () =>
        el.removeEventListener("dblclick", handleDblClick);
    }, 100);

    const cleanupRef = { current: () => {} };
    return () => {
      clearTimeout(timer);
      cleanupRef.current();
    };
  }, [getListEl]);

  // ---------- Scroll to bottom ----------
  const scrollToBottom = useCallback(() => {
    const el = getListEl();
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setNewMessageCount(0);
  }, [getListEl]);

  // ---------- Copy ----------
  const handleCopy = useCallback(async () => {
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      setCopied(true);
      setTimeout(() => {
        setSelectedText(null);
        setCopied(false);
      }, 600);
    } catch {
      setSelectedText(null);
    }
  }, [selectedText]);

  return (
    <>
      {/* New-messages anchor */}
      {isScrolledUp && newMessageCount > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-14 left-1/2 z-10 -translate-x-1/2 rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white shadow-lg transition-opacity hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {newMessageCount} 条新消息 ↓
        </button>
      )}

      {/* Scroll-to-bottom button */}
      {isScrolledUp && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="滚动到底部"
          className="absolute bottom-4 right-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-md transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      )}

      {/* Bottom action-sheet (double-click popup) */}
      {selectedText && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/30 dark:bg-black/50"
            onClick={() => setSelectedText(null)}
          />
          <div className="conductor-action-sheet fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-zinc-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-600" />
            <button
              type="button"
              onClick={handleCopy}
              className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? "已复制" : "复制"}
            </button>
          </div>
        </>
      )}
    </>
  );
}
