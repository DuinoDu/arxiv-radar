import * as cheerio from "cheerio";
import type { ArxivArticle } from "./types";

export const ARXIV_RECENT_URL =
  "https://arxiv.org/list/cs.RO/recent?skip=0&show=100";

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const USER_AGENT = "arxiv-radar/0.1";
const API_BATCH_SIZE = 10;
const API_BATCH_DELAY_MS = 3000;
const ABS_FALLBACK_DELAY_MS = 700;
const FETCH_TIMEOUT_MS = 20000;
const API_FETCH_TIMEOUT_MS = 6000;
const ABS_FETCH_TIMEOUT_MS = 10000;
const ABS_FALLBACK_CONCURRENCY = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 503]);
const FETCH_RETRY_DELAYS_MS = [5000, 15000, 30000, 60000];

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeArxivId(value: string) {
  const trimmed = value.trim();

  // 形如 2605.12182 / 2605.12182v3 / cs/0501001
  const modernMatch = trimmed.match(/(\d{4}\.\d{4,6})(v\d+)?/);
  if (modernMatch) {
    return modernMatch[1];
  }

  const legacyMatch = trimmed.match(/([a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i);
  if (legacyMatch) {
    return legacyMatch[1];
  }

  return trimmed
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf|html|format)\//, "")
    .replace(/\.pdf$/i, "")
    .replace(/^arXiv:/i, "")
    .replace(/v\d+$/i, "");
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function arxivAbsUrl(id: string) {
  return `https://arxiv.org/abs/${id}`;
}

function arxivPdfUrl(id: string) {
  return `https://arxiv.org/pdf/${id}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  return FETCH_RETRY_DELAYS_MS[Math.min(attempt, FETCH_RETRY_DELAYS_MS.length - 1)];
}

function isRetryableFetchError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /abort|timeout|network|socket|terminated/i.test(message);
}

function isMetadataApiFallbackError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /(429|503|Service Unavailable|Unknown Error|abort|timeout)/i.test(message);
}

async function fetchText(
  url: string,
  { retry = true, timeoutMs = FETCH_TIMEOUT_MS }: { retry?: boolean; timeoutMs?: number } = {},
) {
  const maxAttempts = retry ? FETCH_RETRY_DELAYS_MS.length : 0;

  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (response.ok) {
        return await response.text();
      }

      if (retry && RETRYABLE_STATUS_CODES.has(response.status) && attempt < FETCH_RETRY_DELAYS_MS.length) {
        await sleep(retryDelay(response, attempt));
        continue;
      }

      throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
    } catch (error) {
      if (retry && isRetryableFetchError(error) && attempt < FETCH_RETRY_DELAYS_MS.length) {
        await sleep(FETCH_RETRY_DELAYS_MS[Math.min(attempt, FETCH_RETRY_DELAYS_MS.length - 1)]);
        continue;
      }

      if (error instanceof Error && error.message.startsWith("Fetch failed for ")) {
        throw error;
      }

      throw new Error(`Fetch failed for ${url}: ${(error as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`Fetch failed for ${url}`);
}

export async function fetchRecentArticleIds(
  sourceUrl = ARXIV_RECENT_URL,
  limit = 100,
) {
  const html = await fetchText(sourceUrl);
  const $ = cheerio.load(html);
  const ids: string[] = [];

  $("#articles dt a[title='Abstract']").each((_, element) => {
    const id = normalizeArxivId(
      $(element).attr("id") || $(element).text() || $(element).attr("href") || "",
    );

    if (id) {
      ids.push(id);
    }
  });

  return unique(ids).slice(0, limit);
}

function parseAtomEntry(
  $: cheerio.CheerioAPI,
  element: Parameters<cheerio.CheerioAPI>[0],
): ArxivArticle {
  const entry = $(element);
  const id = normalizeArxivId(entry.find("id").first().text());
  const authors = entry
    .find("author name")
    .map((_, author) => normalizeText($(author).text()))
    .get()
    .filter(Boolean);
  const categories = entry
    .find("category")
    .map((_, category) => $(category).attr("term") ?? "")
    .get()
    .filter(Boolean);
  let pdfUrl: string | undefined;

  entry.find("link").each((_, link) => {
    const linkElement = $(link);
    if (linkElement.attr("title") === "pdf") {
      pdfUrl = linkElement.attr("href");
    }
  });

  return {
    id,
    title: normalizeText(entry.find("title").first().text()),
    authors,
    abstract: normalizeText(entry.find("summary").first().text()),
    categories,
    publishedAt: entry.find("published").first().text() || undefined,
    updatedAt: entry.find("updated").first().text() || undefined,
    arxivUrl: `https://arxiv.org/abs/${id}`,
    pdfUrl,
  };
}

function parseAbsDateline(value: string) {
  const submitted = value.match(/Submitted on ([^\]]+)/i)?.[1];
  if (!submitted) {
    return undefined;
  }

  const timestamp = Date.parse(`${submitted} UTC`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function parseAbsCategories(value: string) {
  const categories = Array.from(value.matchAll(/\(([a-z.-]+(?:\.[A-Z]+)?)\)/g), (match) => match[1]);
  return unique(categories);
}

async function fetchArticleMetadataFromAbs(id: string): Promise<ArxivArticle> {
  const normalizedId = normalizeArxivId(id);
  const html = await fetchText(arxivAbsUrl(normalizedId), {
    retry: false,
    timeoutMs: ABS_FETCH_TIMEOUT_MS,
  });
  const $ = cheerio.load(html);
  const title = normalizeText($("h1.title").text().replace(/^Title:\s*/i, ""));
  const authors = $(".authors a")
    .map((_, author) => normalizeText($(author).text()))
    .get()
    .filter(Boolean);
  const abstract = normalizeText($("blockquote.abstract").text().replace(/^\s*Abstract:\s*/i, ""));
  const categories = parseAbsCategories($(".subjects").text());
  const publishedAt = parseAbsDateline($(".dateline").text());

  return {
    id: normalizedId,
    title,
    authors,
    abstract,
    categories,
    publishedAt,
    arxivUrl: arxivAbsUrl(normalizedId),
    pdfUrl: arxivPdfUrl(normalizedId),
  };
}

async function fetchBatchMetadataFromAbs(ids: string[]) {
  const articles: ArxivArticle[] = new Array(ids.length);
  const workerCount = Math.min(ABS_FALLBACK_CONCURRENCY, ids.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < ids.length) {
      const index = nextIndex;
      nextIndex += 1;
      articles[index] = await fetchArticleMetadataFromAbs(ids[index]);

      if (nextIndex < ids.length) {
        await sleep(ABS_FALLBACK_DELAY_MS);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return articles;
}

export async function fetchArticleMetadata(ids: string[]) {
  const articles = new Map<string, ArxivArticle>();
  let shouldUseApi = true;

  for (let offset = 0; offset < ids.length; offset += API_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + API_BATCH_SIZE);
    const url = `${ARXIV_API_URL}?id_list=${batch.map(encodeURIComponent).join(",")}`;

    try {
      if (shouldUseApi) {
        const xml = await fetchText(url, { retry: false, timeoutMs: API_FETCH_TIMEOUT_MS });
        const $ = cheerio.load(xml, { xmlMode: true });

        $("entry").each((_, element) => {
          const article = parseAtomEntry($, element);
          if (article.id) {
            articles.set(article.id, article);
          }
        });
      } else {
        const fallbackArticles = await fetchBatchMetadataFromAbs(batch);
        for (const article of fallbackArticles) {
          articles.set(article.id, article);
        }
      }
    } catch (error) {
      if (!isMetadataApiFallbackError(error)) {
        throw error;
      }

      shouldUseApi = false;
      const fallbackArticles = await fetchBatchMetadataFromAbs(batch);
      for (const article of fallbackArticles) {
        articles.set(article.id, article);
      }
    }

    if (offset + API_BATCH_SIZE < ids.length) {
      await sleep(API_BATCH_DELAY_MS);
    }
  }

  return ids
    .map((id) => articles.get(normalizeArxivId(id)))
    .filter((article): article is ArxivArticle => Boolean(article));
}
