import * as cheerio from "cheerio";
import type { ArxivArticle } from "./types";

export const ARXIV_RECENT_URL =
  "https://arxiv.org/list/cs.RO/recent?skip=0&show=100";

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const USER_AGENT = "arxiv-radar/0.1";
const API_BATCH_SIZE = 50;

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeArxivId(value: string) {
  return value
    .replace(/^https?:\/\/arxiv\.org\/abs\//, "")
    .replace(/^arXiv:/i, "")
    .replace(/v\d+$/i, "")
    .trim();
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
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

export async function fetchArticleMetadata(ids: string[]) {
  const articles = new Map<string, ArxivArticle>();

  for (let offset = 0; offset < ids.length; offset += API_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + API_BATCH_SIZE);
    const url = `${ARXIV_API_URL}?id_list=${batch.map(encodeURIComponent).join(",")}`;
    const xml = await fetchText(url);
    const $ = cheerio.load(xml, { xmlMode: true });

    $("entry").each((_, element) => {
      const article = parseAtomEntry($, element);
      if (article.id) {
        articles.set(article.id, article);
      }
    });
  }

  return ids
    .map((id) => articles.get(normalizeArxivId(id)))
    .filter((article): article is ArxivArticle => Boolean(article));
}
