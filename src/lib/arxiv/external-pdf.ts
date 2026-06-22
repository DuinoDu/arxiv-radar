import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { ArxivArticle } from "./types";

const USER_AGENT = "arxiv-radar/0.1";
const PDF_VALIDATE_TIMEOUT_MS = 15000;
const BLOCKED_HOSTNAME_REGEX = /^(?:localhost|metadata\.google\.internal)$/i;

type PdfProbe = {
  url: string;
  contentType: string;
  contentDisposition: string;
};

export class ExternalPdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalPdfError";
  }
}

function normalizeHostname(hostname: string) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isBlockedIpHostname(hostname: string) {
  const normalized = normalizeHostname(hostname);
  const ipVersion = isIP(normalized);
  if (!ipVersion) return false;

  if (ipVersion === 6) {
    return true;
  }

  return (
    /^127\.\d+\.\d+\.\d+$/.test(normalized) ||
    /^0\.0\.0\.0$/.test(normalized) ||
    /^10\.\d+\.\d+\.\d+$/.test(normalized) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(normalized) ||
    /^192\.168\.\d+\.\d+$/.test(normalized) ||
    /^169\.254\.\d+\.\d+$/.test(normalized)
  );
}

function isSafeExternalUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (BLOCKED_HOSTNAME_REGEX.test(hostname) || isBlockedIpHostname(hostname)) {
    return false;
  }

  return true;
}

function normalizeHttpUrl(rawUrl: string): URL | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;

  try {
    const url = new URL(trimmed);
    url.hash = "";
    if (!isSafeExternalUrl(url.href)) return null;
    return url;
  } catch {
    return null;
  }
}

function isPdfPath(url: URL) {
  return url.pathname.toLowerCase().endsWith(".pdf");
}

function timeoutSignal() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PDF_VALIDATE_TIMEOUT_MS);
  return { controller, timeout };
}

async function requestPdf(url: string, method: "HEAD" | "GET"): Promise<PdfProbe> {
  const { controller, timeout } = timeoutSignal();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/pdf,*/*;q=0.8",
        ...(method === "GET" ? { Range: "bytes=0-0" } : {}),
      },
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 206) {
      throw new ExternalPdfError(`PDF 访问失败：${response.status} ${response.statusText}`);
    }

    const finalUrl = response.url || url;
    if (!isSafeExternalUrl(finalUrl)) {
      throw new ExternalPdfError("PDF 链接重定向到了不安全地址");
    }

    return {
      url: finalUrl,
      contentType: response.headers.get("content-type") ?? "",
      contentDisposition: response.headers.get("content-disposition") ?? "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isPdfResponse(probe: PdfProbe) {
  return /application\/pdf/i.test(probe.contentType);
}

function filenameFromContentDisposition(value: string) {
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  const plain = value.match(/filename="?([^";]+)"?/i)?.[1];
  return plain?.trim();
}

function filenameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const filename = pathname.split("/").filter(Boolean).pop();
    return filename ? decodeURIComponent(filename) : undefined;
  } catch {
    return undefined;
  }
}

function titleFromFilename(filename: string | undefined) {
  const base = (filename ?? "External PDF")
    .replace(/\.pdf$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) return "External PDF";
  return /^[a-z0-9]{2,8}$/.test(base) ? base.toUpperCase() : base;
}

function externalPdfId(url: string) {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `pdf:${hash}`;
}

export async function fetchExternalPdfArticle(rawUrl: string): Promise<ArxivArticle> {
  const parsed = normalizeHttpUrl(rawUrl);
  if (!parsed) {
    throw new ExternalPdfError("非 arXiv 论文必须提供 http(s) PDF 链接");
  }

  if (!isPdfPath(parsed)) {
    throw new ExternalPdfError("非 arXiv 论文必须是直接 PDF 路径（URL path 需以 .pdf 结尾）");
  }

  let probe: PdfProbe;
  try {
    probe = await requestPdf(parsed.href, "HEAD");
  } catch (error) {
    if (error instanceof ExternalPdfError && !/PDF 访问失败：405|PDF 访问失败：403/i.test(error.message)) {
      throw error;
    }
    probe = await requestPdf(parsed.href, "GET");
  }

  if (!isPdfResponse(probe)) {
    throw new ExternalPdfError("该链接不能直接返回 application/pdf");
  }

  const finalUrl = normalizeHttpUrl(probe.url);
  if (!finalUrl || !isPdfPath(finalUrl)) {
    throw new ExternalPdfError("PDF 链接重定向后不再是 .pdf 路径");
  }

  const filename =
    filenameFromContentDisposition(probe.contentDisposition) ||
    filenameFromUrl(finalUrl.href);
  const title = titleFromFilename(filename);
  const now = new Date().toISOString();

  return {
    id: externalPdfId(finalUrl.href),
    title,
    authors: [],
    abstract: `Non-arXiv direct PDF: ${finalUrl.href}`,
    categories: ["external_pdf"],
    publishedAt: now,
    updatedAt: now,
    arxivUrl: finalUrl.href,
    pdfUrl: finalUrl.href,
  };
}
