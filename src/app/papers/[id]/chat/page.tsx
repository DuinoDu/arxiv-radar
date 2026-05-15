import { notFound } from "next/navigation";
import { PaperWorkspace } from "@/components/arxiv/PaperWorkspace";
import { readArxivState } from "@/lib/arxiv/store";

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

  if (mode === "html") return "html";
  if (mode === "chat") return "chat";
  return "pdf";
}

export default async function PaperChatPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const paperId = decodeRouteId(id);
  const view = parseView(query?.view);
  const state = await readArxivState();
  const paper = state.papers.find((candidate) => candidate.id === paperId);

  if (!paper) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-white">
      <PaperWorkspace view={view} paper={paper} />
    </main>
  );
}
