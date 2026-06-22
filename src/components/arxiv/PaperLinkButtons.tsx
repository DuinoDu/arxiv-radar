"use client";

import type { ReactNode, SVGProps } from "react";
import { useEffect, useRef, useState } from "react";

function buttonClassNames(baseClassName?: string, missing = false) {
  const size = baseClassName ?? "h-9 w-9";
  const colors = missing
    ? "border-zinc-200 bg-zinc-100 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-500 active:bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400 dark:active:bg-zinc-800"
    : "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-900";
  return `inline-flex ${size} shrink-0 items-center justify-center rounded-md border transition ${colors}`;
}

export function GithubIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 .5C5.73.5.75 5.48.75 11.75c0 4.97 3.22 9.18 7.69 10.67.56.1.77-.24.77-.54 0-.27-.01-1.16-.02-2.1-3.13.68-3.79-1.34-3.79-1.34-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.94.1-.73.39-1.22.71-1.5-2.5-.28-5.12-1.25-5.12-5.57 0-1.23.44-2.24 1.16-3.03-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.16.9-.25 1.86-.38 2.82-.38.96 0 1.92.13 2.82.38 2.15-1.46 3.1-1.16 3.1-1.16.61 1.55.23 2.7.11 2.98.72.79 1.16 1.8 1.16 3.03 0 4.33-2.62 5.29-5.13 5.56.4.34.76 1.02.76 2.06 0 1.49-.01 2.69-.01 3.06 0 .3.2.65.78.54 4.47-1.49 7.69-5.7 7.69-10.67C23.25 5.48 18.27.5 12 .5Z"
      />
    </svg>
  );
}

export function XSocialIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <path d="M13.74 10.63 21.22 2h-1.77l-6.5 7.5L7.77 2H1.8l7.84 11.36L1.8 22h1.78l6.85-7.47L15.9 22h5.97l-8.13-11.37Zm-2.43 2.8-.8-1.13L4.19 3.33h2.73l5.1 7.24.79 1.13 6.64 9.42h-2.73l-5.41-7.69Z" />
    </svg>
  );
}

function MissingLinkInputButton({
  paperId,
  paperTitle,
  onSubmit,
  icon,
  title,
  ariaLabel,
  placeholder,
  buttonClassName,
  inputClassName = "w-56",
}: {
  paperId: string;
  paperTitle: string;
  onSubmit: (id: string, url: string) => void;
  icon: ReactNode;
  title: string;
  ariaLabel: string;
  placeholder: string;
  buttonClassName?: string;
  inputClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setValue("");
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setValue("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(paperId, trimmed);
    setOpen(false);
    setValue("");
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        title={title}
        aria-label={`${paperTitle} ${ariaLabel}`}
        onClick={() => setOpen((v) => !v)}
        className={`${buttonClassNames(buttonClassName, true)} select-none`}
      >
        {icon}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 flex items-center gap-1 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-800 dark:bg-zinc-950">
          <input
            ref={inputRef}
            type="url"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            className={`h-7 rounded border border-zinc-200 bg-white px-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500 ${inputClassName}`}
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="inline-flex h-7 items-center rounded bg-zinc-900 px-2 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            ✓
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function PaperGithubButton({
  paperId,
  paperTitle,
  githubUrl,
  onSubmit,
  buttonClassName,
}: {
  paperId: string;
  paperTitle: string;
  githubUrl?: string;
  onSubmit: (id: string, githubUrl: string) => void;
  buttonClassName?: string;
}) {
  if (githubUrl) {
    return (
      <a
        href={githubUrl}
        target="_blank"
        rel="noreferrer"
        title="GitHub 代码"
        aria-label={`${paperTitle} GitHub 代码`}
        className={buttonClassNames(buttonClassName)}
      >
        <GithubIcon className="h-4 w-4" />
      </a>
    );
  }

  return (
    <MissingLinkInputButton
      paperId={paperId}
      paperTitle={paperTitle}
      onSubmit={onSubmit}
      icon={<GithubIcon className="h-4 w-4" />}
      title="未找到 GitHub 链接（点击手动输入）"
      ariaLabel="未找到 GitHub 链接（点击手动输入）"
      placeholder="github.com/owner/repo"
      buttonClassName={buttonClassName}
    />
  );
}

export function PaperXButton({
  paperId,
  paperTitle,
  xUrl,
  onSubmit,
  buttonClassName,
}: {
  paperId: string;
  paperTitle: string;
  xUrl?: string;
  onSubmit: (id: string, xUrl: string) => void;
  buttonClassName?: string;
}) {
  if (xUrl) {
    return (
      <a
        href={xUrl}
        target="_blank"
        rel="noreferrer"
        title="X / xhs 链接"
        aria-label={`${paperTitle} X / xhs 链接`}
        className={buttonClassNames(buttonClassName)}
      >
        <XSocialIcon className="h-4 w-4" />
      </a>
    );
  }

  return (
    <MissingLinkInputButton
      paperId={paperId}
      paperTitle={paperTitle}
      onSubmit={onSubmit}
      icon={<XSocialIcon className="h-4 w-4" />}
      title="未找到 X / xhs 链接（点击手动输入）"
      ariaLabel="未找到 X / xhs 链接（点击手动输入）"
      placeholder="x.com/user/status/123 或 xiaohongshu.com/explore/..."
      buttonClassName={buttonClassName}
      inputClassName="w-72 max-w-[70vw]"
    />
  );
}
