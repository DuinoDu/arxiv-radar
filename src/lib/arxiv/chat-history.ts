import { promises as fs } from "fs";
import path from "path";
import type { PaperChatMessage } from "./chat";

const DEFAULT_SESSIONS_DIR_NAME = "sessions";
const configuredMaxMessages = Number(process.env.PAPER_CHAT_MAX_STORED_MESSAGES ?? 200);
const MAX_STORED_MESSAGES = Number.isFinite(configuredMaxMessages)
  ? Math.max(1, Math.floor(configuredMaxMessages))
  : 200;

export type StoredPaperChatMessage = PaperChatMessage & {
  createdAt: string;
  model?: string;
};

let mutationQueue = Promise.resolve();

function getSessionsDir() {
  const configuredName = process.env.PAPER_CHAT_SESSIONS_DIR_NAME;
  const dirName = configuredName ? path.basename(configuredName) : DEFAULT_SESSIONS_DIR_NAME;

  return path.join(process.cwd(), "data", dirName);
}

function encodePaperIdForFile(paperId: string) {
  return encodeURIComponent(paperId);
}

function getSessionPath(paperId: string) {
  return path.join(getSessionsDir(), `${encodePaperIdForFile(paperId)}.jsonl`);
}

function normalizeMessage(value: unknown): StoredPaperChatMessage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const message = value as Partial<StoredPaperChatMessage>;
  if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") {
    return undefined;
  }

  const content = message.content.trim();
  if (!content) {
    return undefined;
  }

  return {
    role: message.role,
    content,
    createdAt: typeof message.createdAt === "string" ? message.createdAt : new Date(0).toISOString(),
    model: typeof message.model === "string" ? message.model : undefined,
  };
}

function parseJsonLine(line: string) {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

async function readSessionMessages(paperId: string): Promise<StoredPaperChatMessage[]> {
  try {
    const raw = await fs.readFile(getSessionPath(paperId), "utf8");

    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseJsonLine)
      .map(normalizeMessage)
      .filter((message): message is StoredPaperChatMessage => Boolean(message))
      .slice(-MAX_STORED_MESSAGES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeSessionMessages(paperId: string, messages: StoredPaperChatMessage[]) {
  const sessionPath = getSessionPath(paperId);
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });

  const lines = messages
    .slice(-MAX_STORED_MESSAGES)
    .map((message) => JSON.stringify(message))
    .join("\n");
  const tempPath = `${sessionPath}.${process.pid}.tmp`;

  await fs.writeFile(tempPath, lines ? `${lines}\n` : "", "utf8");
  await fs.rename(tempPath, sessionPath);
}

async function mutateSessionMessages<T>(
  paperId: string,
  updater: (messages: StoredPaperChatMessage[]) => Promise<T> | T,
) {
  const previousMutation = mutationQueue;
  let releaseMutation: () => void;
  mutationQueue = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });

  await previousMutation;

  try {
    return await updater(await readSessionMessages(paperId));
  } finally {
    releaseMutation!();
  }
}

export async function readPaperChatMessages(paperId: string) {
  return readSessionMessages(paperId);
}

export async function appendPaperChatExchange({
  assistantContent,
  model,
  paperId,
  userContent,
}: {
  assistantContent: string;
  model?: string;
  paperId: string;
  userContent: string;
}) {
  return mutateSessionMessages(paperId, async (existingMessages) => {
    const now = new Date().toISOString();
    const messages = [
      ...existingMessages,
      {
        role: "user" as const,
        content: userContent,
        createdAt: now,
      },
      {
        role: "assistant" as const,
        content: assistantContent,
        createdAt: now,
        model,
      },
    ].slice(-MAX_STORED_MESSAGES);

    await writeSessionMessages(paperId, messages);

    return messages;
  });
}
