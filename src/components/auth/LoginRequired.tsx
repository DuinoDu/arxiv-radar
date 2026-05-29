import { AuthButton } from "@/components/auth/AuthButton";
import { AnimatedGraphBackground } from "@/components/background/AnimatedGraphBackground";

export function LoginRequired() {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-zinc-50 px-4 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <AnimatedGraphBackground />
      <div className="relative z-10 flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <h1 className="text-2xl font-semibold tracking-normal">arxiv-radar</h1>
        <AuthButton initialUser={null} />
      </div>
    </main>
  );
}
