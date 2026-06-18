"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2, Plus, X } from "lucide-react";
import { type PaperTag, type TagConfig } from "@/lib/arxiv/types";
import { useFavorites } from "@/lib/arxiv/useFavorites";

type SubmitState = "idle" | "submitting" | "done" | "error";

export function ManualAddButton({
  onPaperExists,
  tagConfigs,
}: {
  onPaperExists?: (id: string) => void;
  tagConfigs: TagConfig[];
}) {
  const router = useRouter();
  const { addFavorite } = useFavorites();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [xUrl, setXUrl] = useState("");
  const [tags, setTags] = useState<Set<PaperTag>>(new Set());
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    inputRef.current?.focus();

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  function resetForm() {
    setInput("");
    setXUrl("");
    setTags(new Set());
    setState("idle");
    setMessage("");
  }

  function closeDialog() {
    if (state === "submitting") {
      return;
    }

    setOpen(false);
    // 保留一点时间避免动画过程中清空
    setTimeout(resetForm, 150);
  }

  function toggleTag(tag: PaperTag) {
    setTags((previous) => {
      const next = new Set(previous);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }

  async function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed) {
      setState("error");
      setMessage("请输入 arxiv 链接或论文 ID");
      return;
    }

    setState("submitting");
    setMessage("");

    try {
      const response = await fetch("/api/papers/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: trimmed,
          xUrl: xUrl.trim() || undefined,
          tags: Array.from(tags),
        }),
      });
      const payload = await response.json();

      // 论文已存在：自动收藏 + 关闭 modal + 让 dashboard 滚动并高亮
      if (response.status === 409 && payload.paperId) {
        addFavorite(payload.paperId);
        onPaperExists?.(payload.paperId);
        setOpen(false);
        resetForm();
        return;
      }

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "添加失败");
      }

      if (payload.paper?.id) {
        addFavorite(payload.paper.id);
      }

      setState("done");
      setMessage(`已添加并收藏：${payload.paper.id}`);
      router.refresh();
      setTimeout(() => {
        setOpen(false);
        resetForm();
      }, 800);
    } catch (error) {
      setState("error");
      setMessage((error as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="手工增加论文"
        aria-label="手工增加论文"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="manual-add-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              onClick={closeDialog}
            >
          <div
            className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="manual-add-title" className="text-base font-semibold text-zinc-950 dark:text-white">
                  手工增加论文
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  支持 arxiv 链接（html / pdf / abs）或论文 ID（如 2605.12182），创建后自动加入收藏
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={state === "submitting"}
                aria-label="关闭"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="manual-add-input"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-300"
                >
                  arxiv 地址 / ID
                </label>
                <input
                  ref={inputRef}
                  id="manual-add-input"
                  type="text"
                  value={input}
                  disabled={state === "submitting"}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="https://arxiv.org/abs/2605.12182 或 2605.12182"
                  className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-600 dark:focus:border-zinc-600 dark:focus:ring-zinc-800"
                />
              </div>

              <div>
                <label
                  htmlFor="manual-add-x-url"
                  className="block text-xs font-medium text-zinc-600 dark:text-zinc-300"
                >
                  X 链接（可选）
                </label>
                <input
                  id="manual-add-x-url"
                  type="url"
                  value={xUrl}
                  disabled={state === "submitting"}
                  onChange={(event) => setXUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSubmit();
                    }
                  }}
                  placeholder="https://x.com/user/status/123"
                  className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-600 dark:focus:border-zinc-600 dark:focus:ring-zinc-800"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  手动 tag（可选）
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tagConfigs.map((tc) => {
                    const active = tags.has(tc.id as PaperTag);
                    return (
                      <button
                        key={tc.id}
                        type="button"
                        onClick={() => toggleTag(tc.id as PaperTag)}
                        disabled={state === "submitting"}
                        aria-pressed={active}
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition ${
                          active
                            ? "border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-zinc-950"
                            : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        }`}
                      >
                        {tc.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {message ? (
                <div
                  className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
                    state === "error"
                      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                      : state === "done"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  }`}
                >
                  {state === "error" ? (
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : state === "done" ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : null}
                  <span className="break-words">{message}</span>
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                disabled={state === "submitting"}
                className="inline-flex h-9 items-center rounded-md border border-zinc-200 px-3 text-sm text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={state === "submitting" || !input.trim()}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {state === "submitting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden="true" />
                )}
                {state === "submitting" ? "添加中" : "创建"}
              </button>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
