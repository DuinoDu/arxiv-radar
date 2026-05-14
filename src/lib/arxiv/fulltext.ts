import * as cheerio from "cheerio";
import type { ArxivArticle, FullTextStatus } from "./types";

const USER_AGENT = "arxiv-radar/0.1";
const DEFAULT_FULL_TEXT_MAX_CHARS = 50000;
const DEFAULT_FULL_TEXT_TIMEOUT_MS = 10000;

export interface PaperFullText {
  status: FullTextStatus;
  url: string;
  text?: string;
  error?: string;
}

function getFullTextMaxChars() {
  const configuredMax = Number(process.env.ARXIV_FULL_TEXT_MAX_CHARS ?? DEFAULT_FULL_TEXT_MAX_CHARS);

  return Number.isFinite(configuredMax)
    ? Math.max(8000, Math.floor(configuredMax))
    : DEFAULT_FULL_TEXT_MAX_CHARS;
}

function getFullTextTimeoutMs() {
  const configuredTimeout = Number(process.env.ARXIV_FULL_TEXT_TIMEOUT_MS ?? DEFAULT_FULL_TEXT_TIMEOUT_MS);

  return Number.isFinite(configuredTimeout)
    ? Math.max(1000, Math.floor(configuredTimeout))
    : DEFAULT_FULL_TEXT_TIMEOUT_MS;
}

export function arxivHtmlUrl(paper: Pick<ArxivArticle, "id">) {
  return `https://arxiv.org/html/${paper.id}`;
}

export function compactText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function normalizePaperText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractPaperHtmlText(html: string) {
  const $ = cheerio.load(html);

  $("script, style, noscript, svg, nav, header, footer, form, button, .ltx_bibliography").remove();

  const root = $("article").first().length
    ? $("article").first()
    : $(".ltx_page_content").first().length
      ? $(".ltx_page_content").first()
      : $(".ltx_document").first().length
        ? $(".ltx_document").first()
        : $("body");
  const chunks: string[] = [];

  root.find("h1, h2, h3, h4, h5, h6, p, figcaption, caption, li, th, td").each((_, element) => {
    const text = normalizePaperText($(element).text());
    if (text) {
      chunks.push(text);
    }
  });

  const structuredText = chunks.join("\n\n");
  if (structuredText.length > 3000) {
    return structuredText;
  }

  return normalizePaperText(root.text());
}

export async function fetchPaperFullText(paper: Pick<ArxivArticle, "id">): Promise<PaperFullText> {
  const url = arxivHtmlUrl(paper);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getFullTextTimeoutMs());

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,*/*;q=0.8",
      },
      cache: "force-cache",
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status === 404 ? "unavailable" : "failed";

      return {
        status,
        url,
        error: `HTML fetch failed: ${response.status} ${response.statusText}`,
      };
    }

    const html = await response.text();
    const text = compactText(extractPaperHtmlText(html), getFullTextMaxChars());

    if (!text) {
      return {
        status: "unavailable",
        url,
        error: "HTML page did not contain extractable paper text",
      };
    }

    return {
      status: "available",
      url,
      text,
    };
  } catch (error) {
    return {
      status: "failed",
      url,
      error: `HTML fetch failed: ${(error as Error).message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}
