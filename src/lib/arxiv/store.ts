import {
  BlobPreconditionFailedError,
  get,
  put,
  type BlobAccessType,
} from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";
import type { AnalysisRun, AnalyzedPaper, ArxivState } from "./types";

const STATE_VERSION = 1;
const DEFAULT_STORE_FILE_NAME = "arxiv-state.json";
const DEFAULT_BLOB_STATE_PATH = `arxiv/${DEFAULT_STORE_FILE_NAME}`;
const MAX_RUNS = 60;
const MAX_MUTATION_ATTEMPTS = 3;
const configuredMaxStoredPapers = Number(process.env.MAX_STORED_PAPERS ?? 800);
const MAX_STORED_PAPERS = Number.isFinite(configuredMaxStoredPapers)
  ? Math.max(1, Math.floor(configuredMaxStoredPapers))
  : 800;

type StoreBackend = "file" | "blob";

interface StoreSnapshot {
  state: ArxivState;
  etag?: string;
}

function getStoreBackend(): StoreBackend {
  const configuredBackend = process.env.ARXIV_STORE_BACKEND?.toLowerCase();

  if (configuredBackend === "blob" || configuredBackend === "file") {
    return configuredBackend;
  }

  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "file";
}

function getStorePath() {
  const configuredName = process.env.ARXIV_DATA_FILE_NAME;
  const fileName = configuredName ? path.basename(configuredName) : DEFAULT_STORE_FILE_NAME;

  return path.join(process.cwd(), "data", fileName);
}

function getBlobPath() {
  const configuredPath = process.env.ARXIV_BLOB_STATE_PATH;

  if (!configuredPath) {
    return DEFAULT_BLOB_STATE_PATH;
  }

  const normalizedPath = path.posix
    .normalize(configuredPath)
    .replace(/^(\.\.(\/|$))+/, "")
    .replace(/^\/+/, "");

  return normalizedPath && normalizedPath !== "." ? normalizedPath : DEFAULT_BLOB_STATE_PATH;
}

function getBlobAccess(): BlobAccessType {
  return process.env.ARXIV_BLOB_ACCESS === "public" ? "public" : "private";
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

function normalizeState(parsed: Partial<ArxivState>): ArxivState {
  return {
    version: STATE_VERSION,
    updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    processedArticleIds: Array.isArray(parsed.processedArticleIds)
      ? parsed.processedArticleIds
      : [],
    papers: Array.isArray(parsed.papers) ? parsed.papers : [],
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
  };
}

function prepareStateForWrite(state: ArxivState): ArxivState {
  return {
    ...state,
    version: STATE_VERSION,
    updatedAt: new Date().toISOString(),
    processedArticleIds: Array.from(new Set(state.processedArticleIds)),
    papers: state.papers.slice(0, MAX_STORED_PAPERS),
    runs: state.runs.slice(0, MAX_RUNS),
  };
}

async function readFileSnapshot(): Promise<StoreSnapshot> {
  const storePath = getStorePath();

  try {
    const raw = await fs.readFile(storePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<ArxivState>;

    return {
      state: normalizeState(parsed),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        state: createEmptyState(),
      };
    }

    throw error;
  }
}

async function writeFileSnapshot(state: ArxivState) {
  const storePath = getStorePath();
  await fs.mkdir(path.dirname(storePath), { recursive: true });

  const nextState = prepareStateForWrite(state);
  const tempPath = `${storePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, storePath);
}

async function readBlobSnapshot(): Promise<StoreSnapshot> {
  const blob = await get(getBlobPath(), {
    access: getBlobAccess(),
    useCache: false,
  });

  if (!blob || blob.statusCode !== 200) {
    return {
      state: createEmptyState(),
    };
  }

  const raw = await new Response(blob.stream).text();
  const parsed = JSON.parse(raw) as Partial<ArxivState>;

  return {
    state: normalizeState(parsed),
    etag: blob.blob.etag,
  };
}

async function writeBlobSnapshot(snapshot: StoreSnapshot, state: ArxivState) {
  const nextState = prepareStateForWrite(state);

  await put(getBlobPath(), `${JSON.stringify(nextState, null, 2)}\n`, {
    access: getBlobAccess(),
    allowOverwrite: Boolean(snapshot.etag),
    cacheControlMaxAge: 60,
    contentType: "application/json",
    ifMatch: snapshot.etag,
  });
}

async function readStoreSnapshot() {
  return getStoreBackend() === "blob" ? readBlobSnapshot() : readFileSnapshot();
}

async function writeStoreSnapshot(snapshot: StoreSnapshot, state: ArxivState) {
  if (getStoreBackend() === "blob") {
    await writeBlobSnapshot(snapshot, state);
    return;
  }

  await writeFileSnapshot(state);
}

function isWriteConflict(error: unknown) {
  return (
    error instanceof BlobPreconditionFailedError ||
    (error instanceof Error &&
      /(already exists|precondition|if-match|conflict|409|412)/i.test(error.message))
  );
}

async function mutateArxivState(updater: (state: ArxivState) => ArxivState) {
  let lastConflict: unknown;

  for (let attempt = 0; attempt < MAX_MUTATION_ATTEMPTS; attempt += 1) {
    const snapshot = await readStoreSnapshot();
    const nextState = updater(snapshot.state);

    try {
      await writeStoreSnapshot(snapshot, nextState);
      return;
    } catch (error) {
      if (!isWriteConflict(error)) {
        throw error;
      }

      lastConflict = error;
    }
  }

  throw new Error(
    `Failed to update arXiv state after ${MAX_MUTATION_ATTEMPTS} storage conflict(s): ${
      lastConflict instanceof Error ? lastConflict.message : "unknown conflict"
    }`,
  );
}

export async function readArxivState(): Promise<ArxivState> {
  const snapshot = await readStoreSnapshot();
  return snapshot.state;
}

export async function writeArxivState(state: ArxivState) {
  await mutateArxivState(() => state);
}

export async function upsertRun(run: AnalysisRun) {
  await mutateArxivState((state) => ({
    ...state,
    runs: [run, ...state.runs.filter((existingRun) => existingRun.id !== run.id)],
  }));
}

export async function addManualPaper(paper: AnalyzedPaper) {
  await mutateArxivState((state) => {
    const existingPapers = state.papers.filter((existing) => existing.id !== paper.id);
    const processedArticleIds = new Set(state.processedArticleIds);
    processedArticleIds.add(paper.id);

    return {
      ...state,
      processedArticleIds: Array.from(processedArticleIds),
      papers: [paper, ...existingPapers],
    };
  });
}

export async function finishRun(run: AnalysisRun, papers: AnalyzedPaper[]) {
  await mutateArxivState((state) => {
    const paperIds = new Set(papers.map((paper) => paper.id));
    const existingPapers = state.papers.filter((paper) => !paperIds.has(paper.id));
    const processedArticleIds = new Set(state.processedArticleIds);

    for (const paper of papers) {
      processedArticleIds.add(paper.id);
    }

    return {
      ...state,
      processedArticleIds: Array.from(processedArticleIds),
      papers: [...papers, ...existingPapers],
      runs: [run, ...state.runs.filter((existingRun) => existingRun.id !== run.id)],
    };
  });
}
