import { arxivHtmlUrl, isExternalPdfPaper } from "@/lib/arxiv/paper-source";
import type { AnalyzedPaper } from "@/lib/arxiv/types";

/**
 * Initial chat message. This becomes the first row in `tasks.history()` and
 * is visible to the user as a chat bubble, so it reads like a natural request.
 */
export function buildPaperInitialChatMessage(paper: AnalyzedPaper): string {
  const lines: string[] = [];
  if (isExternalPdfPaper(paper)) {
    lines.push(`我想和你讨论这篇非 arXiv PDF 论文：《${paper.title}》。`);
    if (paper.pdfUrl) lines.push(`PDF 原文：${paper.pdfUrl}`);
    lines.push("这篇论文没有 arXiv HTML 页面；需要时请直接读取 PDF 原文链接。");
  } else {
    lines.push(`我想和你讨论这篇 arXiv 论文：《${paper.title}》。`);
    lines.push(`HTML 全文：${arxivHtmlUrl(paper)}`);
    if (paper.pdfUrl) lines.push(`PDF：${paper.pdfUrl}`);
    if (paper.arxivUrl) lines.push(`arXiv 摘要页：${paper.arxivUrl}`);
  }
  if (paper.authors?.length) {
    lines.push(`作者：${paper.authors.join(", ")}`);
  }
  lines.push("");
  lines.push("需要时请基于可访问的论文原文回答，不确定就说不知道，不要编实验数值或结论。");
  return lines.join("\n");
}
