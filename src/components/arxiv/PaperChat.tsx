"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Globe2, MessageSquare, Send } from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import type { AnalyzedPaper } from "@/lib/arxiv/types";

type WorkspaceView = "pdf" | "html" | "chat";

function chatPath(paper: AnalyzedPaper, view: WorkspaceView) {
  return `/papers/${encodeURIComponent(paper.id)}/chat?view=${view}`;
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatResponse = {
  message?: ChatMessage;
  messages?: ChatMessage[];
  error?: string;
};

function apiPath(paperId: string) {
  return `/api/papers/${encodeURIComponent(paperId)}/chat`;
}

export function PaperChat({ paper }: { paper: AnalyzedPaper }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, isSending]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHistory() {
      setIsLoadingHistory(true);
      setError(undefined);

      try {
        const response = await fetch(apiPath(paper.id), {
          signal: controller.signal,
        });
        const payload = (await response.json()) as ChatResponse;

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load chat history");
        }

        setMessages(payload.messages ?? []);
      } catch (requestError) {
        if ((requestError as Error).name !== "AbortError") {
          setError((requestError as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingHistory(false);
        }
      }
    }

    void loadHistory();

    return () => controller.abort();
  }, [paper.id]);

  async function sendMessage() {
    const content = input.trim();
    if (!content || isSending || isLoadingHistory) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setError(undefined);
    setIsSending(true);

    try {
      const response = await fetch(apiPath(paper.id), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      });
      const payload = (await response.json()) as ChatResponse;

      if (!response.ok || !payload.message?.content) {
        throw new Error(payload.error || "Chat request failed");
      }

      setMessages(payload.messages ?? [...nextMessages, payload.message]);
    } catch (requestError) {
      setError((requestError as Error).message);
      setInput(content);
      setMessages(messages);
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  const visibleMessages =
    messages.length > 0
      ? messages
      : [
          {
            role: "assistant" as const,
            content: isLoadingHistory ? "加载中..." : "可以开始了。",
          },
        ];

  return (
    <section className="flex h-[calc(100vh-8rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 lg:h-full lg:min-h-0">
      <div className="flex h-11 items-center justify-between gap-2 border-b border-zinc-200 px-2 dark:border-zinc-800 lg:px-3">
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <Link
            href="/"
            title="论文列表"
            aria-label="论文列表"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <ThemeToggle className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900" />
        </div>

        <h2 className="hidden text-sm font-medium tracking-normal text-zinc-950 dark:text-white lg:block">
          chat
        </h2>

        <div className="inline-flex h-8 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 lg:hidden">
          <Link
            href={chatPath(paper, "pdf")}
            scroll={false}
            aria-pressed={false}
            className="inline-flex items-center gap-1.5 px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            PDF
          </Link>
          <Link
            href={chatPath(paper, "html")}
            scroll={false}
            aria-pressed={false}
            className="inline-flex items-center gap-1.5 border-l border-zinc-200 px-2.5 text-xs font-medium text-zinc-600 transition hover:bg-white dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Globe2 className="h-4 w-4" aria-hidden="true" />
            HTML
          </Link>
          <Link
            href={chatPath(paper, "chat")}
            scroll={false}
            aria-pressed
            className="inline-flex items-center gap-1.5 border-l border-zinc-200 bg-zinc-950 px-2.5 text-xs font-medium text-white dark:border-zinc-800 dark:bg-white dark:text-zinc-950"
          >
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Chat
          </Link>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {visibleMessages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[86%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-6 ${
                message.role === "user"
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950"
                  : "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              }`}
            >
              {message.content}
            </div>
          </div>
        ))}

        {isSending ? (
          <div className="flex justify-start">
            <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              ...
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {error ? (
        <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="border-t border-zinc-200 p-2.5 dark:border-zinc-800">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="输入问题"
            className="min-h-18 flex-1 resize-none rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-white dark:focus:border-zinc-600"
          />
          <button
            type="submit"
            title="发送"
            aria-label="发送"
            disabled={!input.trim() || isSending || isLoadingHistory}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}
