import { marked, type Token, type Tokens } from "marked";

const MIN_TOC_HEADINGS = 4;

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

// Format ISO date to readable format with time (precise to seconds)
function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const time = d.toLocaleTimeString("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return `${date} ${time}`;
  } catch {
    return iso;
  }
}

// Check if two ISO dates fall on the same calendar day
function isSameDay(a: string, b: string): boolean {
  try {
    const da = new Date(a);
    const db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  } catch {
    return false;
  }
}

// Generate a URL-safe slug from heading text
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface TocEntry {
  depth: number;
  text: string;
  slug: string;
}

// Extract headings from pre-lexed markdown tokens for TOC
function extractHeadings(tokens: Token[]): TocEntry[] {
  const headings: TocEntry[] = [];
  const slugCounts = new Map<string, number>();

  for (const token of tokens) {
    if (token.type === "heading" && (token as Tokens.Heading).depth <= 3) {
      const heading = token as Tokens.Heading;
      let slug = slugify(heading.text);
      const count = slugCounts.get(slug) || 0;
      slugCounts.set(slug, count + 1);
      if (count > 0) slug = `${slug}-${count}`;
      headings.push({ depth: heading.depth, text: heading.text, slug });
    }
  }
  return headings;
}

// Build TOC HTML from headings
function buildTocHtml(headings: TocEntry[]): string {
  if (headings.length < MIN_TOC_HEADINGS) return "";

  const items = headings
    .map(
      (h) =>
        `<li class="toc-depth-${h.depth}"><a href="#${escapeHtml(h.slug)}">${escapeHtml(h.text)}</a></li>`,
    )
    .join("\n        ");

  return `
  <button class="toc-toggle" aria-label="目錄"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h14M3 10h14M3 15h14"/></svg></button>
  <div class="toc-overlay"></div>
  <nav class="toc">
    <div class="toc-header">目錄</div>
    <ul>
        ${items}
    </ul>
  </nav>`;
}

// Configure marked: disable raw HTML in output for XSS safety, add heading IDs
function createRenderer(headings: TocEntry[]) {
  const renderer = new marked.Renderer();
  let slugIndex = 0;

  renderer.html = function ({ text }: { text: string }) {
    return `<p>${escapeHtml(text)}</p>`;
  };

  renderer.heading = function ({ text, depth }: { text: string; depth: number }) {
    const entry = headings[slugIndex];
    if (depth <= 3 && entry) {
      slugIndex++;
      return `<h${depth} id="${escapeHtml(entry.slug)}">${text}</h${depth}>`;
    }
    return `<h${depth}>${text}</h${depth}>`;
  };

  return renderer;
}

interface PublicPageData {
  title: string;
  content: string;
  tags: string[];
  created: string;
  modified: string;
}

export function renderPublicPage(data: PublicPageData): string {
  const titleEscaped = escapeHtml(data.title);
  const description = escapeHtml(stripMarkdown(data.content, 200));

  // Single tokenization pass: extract headings, then render from pre-lexed tokens
  const tokens = marked.lexer(data.content);
  const headings = extractHeadings(tokens);
  const hasToc = headings.length >= MIN_TOC_HEADINGS;
  const tocHtml = buildTocHtml(headings);

  // Render from pre-lexed tokens with heading IDs
  const renderer = createRenderer(headings);
  const renderedContent = marked.parser(tokens, { renderer }) as string;

  // Format dates
  const createdFormatted = formatDateTime(data.created);
  const sameDay = isSameDay(data.created, data.modified);
  const metaDate = sameDay
    ? createdFormatted
    : `${createdFormatted} 建立 · ${formatDateTime(data.modified)} 更新`;

  const tagsHtml =
    data.tags.length > 0
      ? `<div class="tags">${data.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>`
      : "";

  const tocCss = hasToc
    ? `
    /* TOC - Desktop */
    .toc {
      position: fixed;
      top: 2rem;
      left: max(1rem, calc((100vw - 720px) / 2 - 260px));
      width: 220px;
      max-height: calc(100vh - 4rem);
      overflow-y: auto;
      font-size: 0.8rem;
      line-height: 1.5;
    }
    .toc-header {
      font-weight: 600;
      margin-bottom: 0.5rem;
      font-size: 0.85rem;
      color: #444;
    }
    .toc ul { list-style: none; padding: 0; margin: 0; }
    .toc li { margin-bottom: 0.25rem; }
    .toc a {
      color: #666;
      text-decoration: none;
      display: block;
      padding: 0.15rem 0;
      border-left: 2px solid transparent;
      padding-left: 0.5rem;
      transition: color 0.2s, border-color 0.2s;
    }
    .toc a:hover { color: #2563eb; }
    .toc a.active { color: #2563eb; border-left-color: #2563eb; font-weight: 500; }
    .toc .toc-depth-2 { padding-left: 1rem; }
    .toc .toc-depth-3 { padding-left: 1.75rem; }
    .toc-toggle { display: none; }
    .toc-overlay { display: none; }

    /* TOC - Mobile */
    @media (max-width: 1100px) {
      .toc {
        position: fixed;
        top: 0;
        left: 0;
        width: 260px;
        height: 100vh;
        max-height: 100vh;
        background: #fafafa;
        padding: 1.5rem 1rem;
        transform: translateX(-100%);
        transition: transform 0.3s ease;
        z-index: 100;
        box-shadow: none;
      }
      .toc.open {
        transform: translateX(0);
        box-shadow: 2px 0 12px rgba(0,0,0,0.1);
      }
      .toc-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        position: fixed;
        top: 1rem;
        left: 1rem;
        z-index: 99;
        width: 36px;
        height: 36px;
        border: 1px solid #ddd;
        border-radius: 0.5rem;
        background: #fff;
        color: #666;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      }
      .toc-toggle:hover { background: #f0f0f0; }
      .toc-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.3);
        z-index: 99;
      }
      .toc-overlay.open { display: block; }
    }
    @media (prefers-color-scheme: dark) {
      .toc { background: #1a1a1a; }
      .toc-header { color: #aaa; }
      .toc a { color: #888; }
      .toc a:hover { color: #6cb4ee; }
      .toc a.active { color: #6cb4ee; border-left-color: #6cb4ee; }
      .toc-toggle { background: #2a2a2a; border-color: #444; color: #aaa; }
      .toc-toggle:hover { background: #333; }
      .toc-overlay.open { background: rgba(0,0,0,0.5); }
    }`
    : "";

  const backToTopCss = `
    /* Back to top */
    .back-to-top {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      width: 40px;
      height: 40px;
      border: 1px solid #ddd;
      border-radius: 50%;
      background: #fff;
      color: #666;
      font-size: 1.2rem;
      cursor: pointer;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
      z-index: 50;
    }
    .back-to-top.visible { opacity: 1; pointer-events: auto; }
    .back-to-top:hover { background: #f0f0f0; }
    @media (prefers-color-scheme: dark) {
      .back-to-top { background: #2a2a2a; border-color: #444; color: #aaa; }
      .back-to-top:hover { background: #333; }
    }`;

  const inlineJs = `
  <script>
    (function() {
      const backToTop = document.querySelector('.back-to-top');
      if (backToTop) {
        window.addEventListener('scroll', function() {
          backToTop.classList.toggle('visible', window.scrollY > window.innerHeight);
        }, { passive: true });
        backToTop.addEventListener('click', function() {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      }
      ${
        hasToc
          ? `
      const tocToggle = document.querySelector('.toc-toggle');
      const toc = document.querySelector('.toc');
      const overlay = document.querySelector('.toc-overlay');
      function closeToc() { toc.classList.remove('open'); overlay.classList.remove('open'); }
      function openToc() { toc.classList.add('open'); overlay.classList.add('open'); }
      if (tocToggle) {
        tocToggle.addEventListener('click', function() { toc.classList.contains('open') ? closeToc() : openToc(); });
        overlay.addEventListener('click', closeToc);
        toc.querySelectorAll('a').forEach(function(a) { a.addEventListener('click', closeToc); });
      }
      const tocLinks = document.querySelectorAll('.toc a');
      const headingEls = document.querySelectorAll('.content h1[id], .content h2[id], .content h3[id]');
      if (headingEls.length > 0 && 'IntersectionObserver' in window) {
        const obs = new IntersectionObserver(function(entries) {
          entries.forEach(function(entry) {
            if (entry.isIntersecting) {
              tocLinks.forEach(function(l) { l.classList.remove('active'); });
              const active = document.querySelector('.toc a[href="#' + entry.target.id + '"]');
              if (active) active.classList.add('active');
            }
          });
        }, { rootMargin: '0px 0px -70% 0px', threshold: 0 });
        headingEls.forEach(function(el) { obs.observe(el); });
      }`
          : ""
      }
    })();
  </script>`;

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
    }${tocCss}${backToTopCss}
  </style>
</head>
<body>
  ${tocHtml}
  <article>
    <h1>${titleEscaped}</h1>
    <div class="meta">${metaDate}</div>
    ${tagsHtml}
    <div class="content">${renderedContent}</div>
  </article>
  <button class="back-to-top" aria-label="回到頂部">&#8593;</button>
  <div class="footer">Powered by Sparkle</div>
  ${inlineJs}
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
