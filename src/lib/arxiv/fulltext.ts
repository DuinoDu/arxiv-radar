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
  githubUrl?: string;
}

const GITHUB_URL_REGEX =
  /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._\-#/]*)?/gi;
const NON_REPO_GITHUB_PATH_REGEX =
  /github\.com\/(?:about|features|pricing|enterprise|customer-stories|security|team|topics|trending|marketplace|explore|notifications|settings|search|sponsors|orgs|login|join|new|readme|codespaces|issues|pulls|blog)(?:\/|$)/;
const NON_PAPER_GITHUB_REPO_REGEX =
  /github\.com\/(?:arxiv\/html_feedback|brucemiller\/latexml)(?:\/|$)/;

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

export function extractGithubUrl(...sources: Array<string | undefined>) {
  for (const source of sources) {
    if (!source) {
      continue;
    }

    const matches = source.match(GITHUB_URL_REGEX);
    if (!matches || matches.length === 0) {
      continue;
    }

    for (const raw of matches) {
      // Strip trailing punctuation that often gets glued onto URLs in prose.
      const cleaned = raw.replace(/[).,;:'"”’\]>]+$/g, "");
      const normalized = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
      const lower = cleaned.toLowerCase();

      // Skip non-repo paths we don't want to deep-link to.
      if (
        /github\.com\/?$/.test(lower) ||
        NON_REPO_GITHUB_PATH_REGEX.test(lower) ||
        NON_PAPER_GITHUB_REPO_REGEX.test(lower)
      ) {
        continue;
      }

      return normalized;
    }
  }

  return undefined;
}

function scoreGithubContext(value: string) {
  let score = 1;
  const lower = value.toLowerCase();

  if (/\b(code|github|repo|repository|implementation|source|project)\b/.test(lower)) {
    score += 5;
  }

  if (/\b(available|released|open[-\s]?source|website|page)\b/.test(lower)) {
    score += 2;
  }

  if (/\b(reference|references|bibliography|citation)\b/.test(lower)) {
    score -= 4;
  }

  return score;
}

function extractGithubUrlFromHtml(html: string) {
  const $ = cheerio.load(html);
  const candidates: Array<{ score: number; url: string }> = [];
  const paperRoot = $("article").first().length
    ? $("article").first()
    : $(".ltx_page_content").first().length
      ? $(".ltx_page_content").first()
      : $(".ltx_document").first().length
        ? $(".ltx_document").first()
        : $("body");

  paperRoot
    .find("script, style, noscript, svg, nav, header, footer, form, button, .ltx_bibliography, .ltx_bibitem, .ltx_biblist")
    .remove();

  paperRoot.find("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const url = extractGithubUrl(href);
    if (!url) {
      return;
    }

    const inBibliography = $(element).closest(".ltx_bibliography, .ltx_bibitem, .ltx_biblist").length > 0;
    if (inBibliography) {
      return;
    }

    const context = normalizePaperText(`${$(element).text()} ${$(element).parent().text()}`);
    candidates.push({
      score: scoreGithubContext(context),
      url,
    });
  });

  return candidates.sort((a, b) => b.score - a.score)[0]?.url;
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
    const githubUrl = extractGithubUrlFromHtml(html);

    if (!text) {
      return {
        status: "unavailable",
        url,
        githubUrl,
        error: "HTML page did not contain extractable paper text",
      };
    }

    return {
      status: "available",
      url,
      text,
      githubUrl,
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
