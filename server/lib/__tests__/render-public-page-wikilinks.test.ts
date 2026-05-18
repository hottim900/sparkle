import { describe, it, expect } from "vitest";
import { renderPublicPage } from "../render-public-page.js";

/**
 * ENG-19: `[[…]]` syntax must be stripped from public share pages so
 * Sparkle markup doesn't leak to share viewers. Combined with ENG-3
 * (rename engine skip on shared sources), this closes the title-leak
 * path. Code-block contents are preserved verbatim — a user who wrote
 * `[[example]]` inside a fenced block expected the literal text to render.
 */

describe("renderPublicPage ENG-19 strip wikilinks", () => {
  const base = {
    title: "Test",
    tags: [],
    created: "2026-05-18T00:00:00Z",
    modified: "2026-05-18T00:00:00Z",
  };

  it("renders `[[Foo]]` as plain text `Foo` outside code blocks", () => {
    const html = renderPublicPage({ ...base, content: "see [[Private Title]] now" });
    expect(html).toContain("see Private Title now");
    expect(html).not.toContain("[[Private Title]]");
  });

  it("renders alias `[[Foo|bar]]` as `bar`", () => {
    const html = renderPublicPage({ ...base, content: "click [[Real|display label]] here" });
    expect(html).toContain("click display label here");
    expect(html).not.toContain("[[Real|display label]]");
    expect(html).not.toContain("Real");
  });

  it("preserves literal `[[example]]` inside fenced code block", () => {
    const content = "before\n\n```\n[[example]]\n```\n\nafter";
    const html = renderPublicPage({ ...base, content });
    expect(html).toContain("[[example]]");
  });

  it("preserves literal `[[code]]` inside inline backticks", () => {
    const html = renderPublicPage({
      ...base,
      content: "use `[[code]]` for refs",
    });
    expect(html).toContain("[[code]]");
  });

  it("OpenGraph description also has wikilinks stripped", () => {
    const html = renderPublicPage({
      ...base,
      content: "summary [[Secret]] content",
    });
    // The OG description should be the stripped form
    expect(html).toMatch(/<meta property="og:description" content="[^"]*summary Secret content/);
  });

  it("no-op when content has no wikilinks", () => {
    const html = renderPublicPage({ ...base, content: "just plain markdown content" });
    expect(html).toContain("just plain markdown content");
  });
});
