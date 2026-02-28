import { marked } from "marked";

// Escape HTML entities to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Strip markdown syntax for plain text description (OpenGraph)
function stripMarkdown(md: string, maxLen: number): string {
  return md
    .replace(/#{1,6}\s+/g, "") // headings
    .replace(/\*\*(.+?)\*\*/g, "$1") // bold
    .replace(/\*(.+?)\*/g, "$1") // italic
    .replace(/__(.+?)__/g, "$1") // bold
    .replace(/_(.+?)_/g, "$1") // italic
    .replace(/`(.+?)`/g, "$1") // inline code
    .replace(/```[\s\S]*?```/g, "") // code blocks
    .replace(/\[(.+?)\]\(.+?\)/g, "$1") // links
    .replace(/!\[.*?\]\(.+?\)/g, "") // images
    .replace(/>\s+/g, "") // blockquotes
    .replace(/[-*+]\s+/g, "") // list items
    .replace(/\d+\.\s+/g, "") // ordered list items
    .replace(/\n{2,}/g, " ") // multiple newlines
    .replace(/\n/g, " ") // single newlines
    .trim()
    .slice(0, maxLen);
}

// Format ISO date to readable format
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// Configure marked: disable raw HTML in output for XSS safety
const renderer = new marked.Renderer();
renderer.html = function ({ text }: { text: string }) {
  return `<p>${escapeHtml(text)}</p>`;
};

marked.setOptions({
  renderer,
  gfm: true,
  breaks: true,
});

interface PublicPageData {
  title: string;
  content: string;
  tags: string[];
  created: string;
}

export function renderPublicPage(data: PublicPageData): string {
  const titleEscaped = escapeHtml(data.title);
  const description = escapeHtml(stripMarkdown(data.content, 200));
  const renderedContent = marked.parse(data.content) as string;
  const dateFormatted = formatDate(data.created);

  const tagsHtml =
    data.tags.length > 0
      ? `<div class="tags">${data.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titleEscaped} — Sparkle</title>
  <meta name="description" content="${description}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${titleEscaped}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="Sparkle">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif;
      line-height: 1.7;
      max-width: 720px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
      color: #1a1a1a;
      background: #fafafa;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e0e0e0; background: #1a1a1a; }
      a { color: #6cb4ee; }
      .tag { background: #2a2a2a; color: #aaa; }
      .meta { color: #888; }
      pre { background: #2a2a2a; }
      code { background: #2a2a2a; }
      blockquote { border-color: #444; color: #aaa; }
      hr { border-color: #333; }
    }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; line-height: 1.3; }
    .meta { color: #666; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 1.5rem; }
    .tag {
      display: inline-block;
      background: #eee;
      color: #555;
      padding: 0.15rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.8rem;
    }
    .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
      margin-top: 1.5rem; margin-bottom: 0.5rem;
    }
    .content p { margin-bottom: 1rem; }
    .content a { color: #2563eb; text-decoration: none; }
    .content a:hover { text-decoration: underline; }
    .content ul, .content ol { margin-bottom: 1rem; padding-left: 1.5rem; }
    .content li { margin-bottom: 0.3rem; }
    .content pre {
      background: #f0f0f0;
      padding: 1rem;
      border-radius: 0.5rem;
      overflow-x: auto;
      margin-bottom: 1rem;
      font-size: 0.875rem;
    }
    .content code {
      background: #f0f0f0;
      padding: 0.15rem 0.3rem;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
    .content pre code { background: none; padding: 0; }
    .content blockquote {
      border-left: 3px solid #ddd;
      padding-left: 1rem;
      color: #666;
      margin-bottom: 1rem;
    }
    .content img { max-width: 100%; height: auto; border-radius: 0.5rem; }
    .content hr { border: none; border-top: 1px solid #ddd; margin: 1.5rem 0; }
    .content table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
    .content th, .content td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    .footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid #eee;
      font-size: 0.8rem;
      color: #999;
    }
    @media (prefers-color-scheme: dark) {
      .footer { border-color: #333; }
      .content th, .content td { border-color: #444; }
    }
  </style>
</head>
<body>
  <article>
    <h1>${titleEscaped}</h1>
    <div class="meta">${dateFormatted}</div>
    ${tagsHtml}
    <div class="content">${renderedContent}</div>
  </article>
  <div class="footer">Powered by Sparkle</div>
</body>
</html>`;
}

export function renderNotFoundPage(): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 — Sparkle</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans TC", sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      color: #1a1a1a;
      background: #fafafa;
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e0e0e0; background: #1a1a1a; }
    }
    .container { text-align: center; }
    h1 { font-size: 3rem; margin-bottom: 0.5rem; }
    p { color: #666; }
    @media (prefers-color-scheme: dark) { p { color: #888; } }
  </style>
</head>
<body>
  <div class="container">
    <h1>404</h1>
    <p>找不到此分享頁面</p>
  </div>
</body>
</html>`;
}
