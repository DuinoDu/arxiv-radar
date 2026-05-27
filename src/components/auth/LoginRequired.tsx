import { AuthButton } from "@/components/auth/AuthButton";

export function LoginRequired() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-zinc-50 px-4 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-normal">arxiv-radar</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            使用 Conductor 登录后查看论文雷达。
          </p>
        </div>
        <AuthButton initialUser={null} />
      </div>
    </main>
  );
}
