import { notFound } from "next/navigation";
import { PaperWorkspace } from "@/components/arxiv/PaperWorkspace";
import { readArxivState } from "@/lib/arxiv/store";
import { getCurrentAuthUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams?: Promise<{
    view?: string | string[];
  }>;
};

function decodeRouteId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseView(value?: string | string[]) {
  const mode = Array.isArray(value) ? value[0] : value;

  if (mode === "pdf") return "pdf";
  if (mode === "html") return "html";
  // Default to chat so mobile lands on the chat panel; desktop layout
  // is unaffected because both panels render side-by-side on lg+.
  return "chat";
}

export default async function PaperChatPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const paperId = decodeRouteId(id);
  const view = parseView(query?.view);
  const [state, authUser] = await Promise.all([readArxivState(), getCurrentAuthUser()]);
  const paper = state.papers.find((candidate) => candidate.id === paperId);

  if (!paper) {
    notFound();
  }

  return (
    <main className="min-h-[100dvh] bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <PaperWorkspace view={view} paper={paper} authenticated={Boolean(authUser)} />
    </main>
  );
}
