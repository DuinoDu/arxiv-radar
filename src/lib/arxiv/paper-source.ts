import type { ArxivArticle } from "./types";

export function isArxivPaper(paper: Pick<ArxivArticle, "arxivUrl" | "id">) {
  try {
    const url = new URL(paper.arxivUrl);
    return /(^|\.)arxiv\.org$/i.test(url.hostname);
  } catch {
    return /^([a-z\-]+(?:\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,6})$/i.test(paper.id);
  }
}

export function isExternalPdfPaper(paper: Pick<ArxivArticle, "arxivUrl" | "id" | "pdfUrl">) {
  return Boolean(paper.pdfUrl) && !isArxivPaper(paper);
}

export function arxivHtmlUrl(paper: Pick<ArxivArticle, "id">) {
  return `https://arxiv.org/html/${paper.id}`;
}

export function paperHtmlUrl(paper: Pick<ArxivArticle, "arxivUrl" | "id">) {
  return isArxivPaper(paper) ? arxivHtmlUrl(paper) : undefined;
}

export function paperPdfUrl(paper: Pick<ArxivArticle, "id" | "pdfUrl">) {
  return (paper.pdfUrl || `https://arxiv.org/pdf/${paper.id}`).replace(/^http:/, "https:");
}
