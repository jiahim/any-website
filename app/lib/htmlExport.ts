/**
 * 清理 AI 输出中可能包含的 Markdown 代码块标记。
 */
export function cleanMarkdownCodeBlock(content: string): string {
  let cleaned = content.trim();

  if (cleaned.startsWith("```html")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }

  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }

  return cleaned;
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildHeadMetadata(path: string): string {
  const title = escapeHtmlText(decodePath(path).trim() || "Any Website Page");
  return `<meta charset="utf-8"><title>${title}</title>`;
}

/**
 * 清洗模型输出，并保证文档包含 UTF-8 charset 与非空 title。
 */
export function buildDownloadHtml(streamData: string, path: string): string {
  const html = cleanMarkdownCodeBlock(streamData);
  const headMatch = html.match(/<head\b[^>]*>/i);

  if (!headMatch || headMatch.index === undefined) {
    const head = `<head>${buildHeadMetadata(path)}</head>`;
    const htmlMatch = html.match(/<html\b[^>]*>/i);

    if (htmlMatch && htmlMatch.index !== undefined) {
      const insertAt = htmlMatch.index + htmlMatch[0].length;
      return `${html.slice(0, insertAt)}${head}${html.slice(insertAt)}`;
    }

    return `<!DOCTYPE html><html>${head}<body>${html}</body></html>`;
  }

  const headStart = headMatch.index + headMatch[0].length;
  const headEndMatch = html.slice(headStart).match(/<\/head\s*>/i);
  const headEnd = headEndMatch?.index === undefined
    ? html.length
    : headStart + headEndMatch.index;
  const headContent = html.slice(headStart, headEnd);
  const hasCharset = /<meta\b[^>]*\bcharset\s*=/i.test(headContent);
  const titleMatch = headContent.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const hasNonEmptyTitle = Boolean(titleMatch?.[1].trim());

  let metadata = "";
  if (!hasCharset) metadata += '<meta charset="utf-8">';
  if (!hasNonEmptyTitle) {
    const title = escapeHtmlText(decodePath(path).trim() || "Any Website Page");
    metadata += `<title>${title}</title>`;
  }

  if (!metadata) return html;

  if (titleMatch && !hasNonEmptyTitle) {
    const titleStart = headStart + (titleMatch.index ?? 0);
    const titleEnd = titleStart + titleMatch[0].length;
    const title = escapeHtmlText(decodePath(path).trim() || "Any Website Page");
    const charset = hasCharset ? "" : '<meta charset="utf-8">';
    return `${html.slice(0, headStart)}${charset}${html.slice(headStart, titleStart)}<title>${title}</title>${html.slice(titleEnd)}`;
  }

  return `${html.slice(0, headStart)}${metadata}${html.slice(headStart)}`;
}

/**
 * 将用户路径转换为跨平台安全的 HTML 文件名。
 */
export function buildDownloadFileName(path: string): string {
  const decodedPath = decodePath(path);
  const safeName = decodedPath
    .replaceAll("/", "-")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 100)
    .replace(/[. ]+$/g, "");

  return `${safeName || "any-website-page"}.html`;
}
