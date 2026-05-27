"use client";

import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { PaperChat } from "@/components/arxiv/PaperChat";
import { PaperReader } from "@/components/arxiv/PaperReader";
import type { AnalyzedPaper } from "@/lib/arxiv/types";

type WorkspaceView = "pdf" | "html" | "chat";
type ReaderMode = "pdf" | "html";

const DEFAULT_READER_PERCENT = 66;
const MIN_READER_PERCENT = 38;
const MAX_READER_PERCENT = 78;

function clamp(value: number) {
  return Math.min(Math.max(value, MIN_READER_PERCENT), MAX_READER_PERCENT);
}

export function PaperWorkspace({
  view,
  paper,
  authenticated,
}: {
  view: WorkspaceView;
  paper: AnalyzedPaper;
  authenticated: boolean;
}) {
  const [readerPercent, setReaderPercent] = useState(DEFAULT_READER_PERCENT);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // On desktop the reader always renders; if the URL view is "chat", default the reader to PDF.
  const readerMode: ReaderMode = view === "html" ? "html" : "pdf";
  const isChatView = view === "chat";

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isDragging]);

  function updateFromClientX(clientX: number) {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0) {
      return;
    }

    setReaderPercent(clamp(((clientX - bounds.left) / bounds.width) * 100));
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    updateFromClientX(event.clientX);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (!isDragging) {
      return;
    }

    updateFromClientX(event.clientX);
  }

  function stopDragging(event: PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    setIsDragging(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setReaderPercent((value) => clamp(value - 4));
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      setReaderPercent((value) => clamp(value + 4));
    }
  }

  return (
    <div
      ref={containerRef}
      className="mx-auto flex max-w-[96rem] flex-col gap-3 p-0 lg:h-screen lg:flex-row lg:gap-0"
    >
      <div
        className={`min-w-0 lg:h-full ${isChatView ? "hidden lg:block" : ""} ${
          isDragging ? "[&_iframe]:pointer-events-none" : ""
        }`}
        style={{
          flexBasis: `calc(${readerPercent}% - 0.375rem)`,
          flexGrow: 0,
          flexShrink: 0,
        }}
      >
        <PaperReader mode={readerMode} paper={paper} />
      </div>

      <button
        type="button"
        aria-label="调整面板宽度"
        aria-orientation="vertical"
        aria-valuemin={MIN_READER_PERCENT}
        aria-valuemax={MAX_READER_PERCENT}
        aria-valuenow={Math.round(readerPercent)}
        className="group hidden w-3 shrink-0 cursor-col-resize items-center justify-center outline-none lg:flex"
        role="separator"
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
      >
        <span className="flex h-full w-3 items-center justify-center">
          <span
            className={`flex h-14 w-1 items-center justify-center rounded-full transition ${
              isDragging
                ? "bg-zinc-400 dark:bg-zinc-500"
                : "bg-transparent group-hover:bg-zinc-300 group-focus-visible:bg-zinc-400 dark:group-hover:bg-zinc-700"
            }`}
          >
            <GripVertical className="h-4 w-4 text-zinc-500 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-zinc-400" />
          </span>
        </span>
      </button>

      {isDragging ? <div className="fixed inset-0 z-50 cursor-col-resize lg:block" aria-hidden="true" /> : null}

      <div className={`min-w-0 lg:h-full lg:flex-1 ${isChatView ? "" : "hidden lg:block"}`}>
        <PaperChat paper={paper} authenticated={authenticated} />
      </div>
    </div>
  );
}
