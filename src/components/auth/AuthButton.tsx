"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn, LogOut, UserRound } from "lucide-react";
import type { PublicAuthUser } from "@/lib/auth/session";

type AuthPayload = {
  authenticated?: boolean;
  user?: PublicAuthUser | null;
};

function userLabel(user: PublicAuthUser) {
  return user.name || user.email || user.phone || user.id.slice(0, 8);
}

export function AuthButton({
  compact = false,
  initialUser,
}: {
  compact?: boolean;
  initialUser: PublicAuthUser | null;
}) {
  const router = useRouter();
  const [user, setUser] = useState<PublicAuthUser | null>(initialUser);
  const [busy, setBusy] = useState(false);
  const label = useMemo(() => (user ? userLabel(user) : "登录"), [user]);

  async function refreshUser() {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as AuthPayload;
      setUser(payload.authenticated && payload.user ? payload.user : null);
    } catch {
      // Keep current optimistic state.
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
      setUser(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!user) {
    return (
      <a
        href="/api/auth/login"
        onFocus={refreshUser}
        className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:hover:text-white ${
          compact ? "w-10 px-0" : ""
        }`}
        aria-label="使用 Conductor 登录"
        title="使用 Conductor 登录"
      >
        <LogIn className="h-4 w-4" aria-hidden="true" />
        {compact ? null : <span>登录</span>}
      </a>
    );
  }

  return (
    <div className="inline-flex min-h-10 items-center overflow-hidden rounded-md border border-zinc-200 bg-white text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
      <span
        className={`inline-flex min-w-0 items-center gap-2 px-3 py-2 ${compact ? "hidden" : ""}`}
        title={label}
      >
        <UserRound className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="max-w-36 truncate">{label}</span>
      </span>
      <button
        type="button"
        onClick={logout}
        disabled={busy}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center border-l border-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:hover:bg-zinc-900 dark:hover:text-white"
        aria-label="退出登录"
        title="退出登录"
      >
        {compact ? <UserRound className="h-4 w-4" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
}
