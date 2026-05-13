import { promises as fs } from "fs";
import path from "path";
import type { AnalysisRun, AnalyzedPaper, ArxivState } from "./types";

const STATE_VERSION = 1;
const DEFAULT_STORE_FILE_NAME = "arxiv-state.json";
const MAX_RUNS = 60;
const configuredMaxStoredPapers = Number(process.env.MAX_STORED_PAPERS ?? 800);
const MAX_STORED_PAPERS = Number.isFinite(configuredMaxStoredPapers)
  ? Math.max(1, Math.floor(configuredMaxStoredPapers))
  : 800;

function getStorePath() {
  const configuredName = process.env.ARXIV_DATA_FILE_NAME;
  const fileName = configuredName ? path.basename(configuredName) : DEFAULT_STORE_FILE_NAME;

  return path.join(process.cwd(), "data", fileName);
}

function createEmptyState(): ArxivState {
  return {
    version: STATE_VERSION,
    updatedAt: new Date(0).toISOString(),
    processedArticleIds: [],
    papers: [],
    runs: [],
  };
}

export async function readArxivState(): Promise<ArxivState> {
  const storePath = getStorePath();

  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ArxivState>;

    return {
      version: STATE_VERSION,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      processedArticleIds: Array.isArray(parsed.processedArticleIds)
        ? parsed.processedArticleIds
        : [],
      papers: Array.isArray(parsed.papers) ? parsed.papers : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyState();
    }

    throw error;
  }
}

export async function writeArxivState(state: ArxivState) {
  const storePath = getStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });

  const nextState: ArxivState = {
    ...state,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    processedArticleIds: Array.from(new Set(state.processedArticleIds)),
    papers: state.papers.slice(0, MAX_STORED_PAPERS),
    runs: state.runs.slice(0, MAX_RUNS),
  };

  const tempPath = `${storePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, storePath);
}

export async function upsertRun(run: AnalysisRun) {
  const state = await readArxivState();
  const remainingRuns = state.runs.filter((existingRun) => existingRun.id !== run.id);
  await writeArxivState({
    ...state,
    runs: [run, ...remainingRuns],
  });
}

export async function finishRun(run: AnalysisRun, papers: AnalyzedPaper[]) {
  const state = await readArxivState();
  const paperIds = new Set(papers.map((paper) => paper.id));
  const existingPapers = state.papers.filter((paper) => !paperIds.has(paper.id));
  const processedArticleIds = new Set(state.processedArticleIds);

  for (const paper of papers) {
    processedArticleIds.add(paper.id);
  }

  await writeArxivState({
    ...state,
    processedArticleIds: Array.from(processedArticleIds),
    papers: [...papers, ...existingPapers],
    runs: [run, ...state.runs.filter((existingRun) => existingRun.id !== run.id)],
  });
}
