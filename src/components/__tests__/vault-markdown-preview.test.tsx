import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { VaultMarkdownPreview, preprocessObsidian } from "../vault-markdown-preview";

describe("preprocessObsidian", () => {
  it("strips YAML frontmatter", () => {
    const input = "---\ntitle: Test\ntags: []\n---\nBody content";
    expect(preprocessObsidian(input)).toBe("Body content");
  });

  it("converts wikilinks [[target]] to bold text", () => {
    expect(preprocessObsidian("See [[My Note]] for details")).toBe("See **My Note** for details");
  });

  it("converts aliased wikilinks [[target|alias]] to bold alias", () => {
    expect(preprocessObsidian("Read [[long-note-name|this note]]")).toBe("Read **this note**");
  });

  it("converts embeds ![[filename]] to placeholder", () => {
    expect(preprocessObsidian("Content ![[diagram.png]] here")).toBe(
      "Content [內嵌：diagram.png] here",
    );
  });

  it("strips Obsidian comments %%...%%", () => {
    expect(preprocessObsidian("Before %%hidden%% after")).toBe("Before  after");
  });

  it("strips multi-line Obsidian comments", () => {
    const input = "Before %%\nthis is hidden\nacross lines\n%% after";
    expect(preprocessObsidian(input)).toBe("Before  after");
  });

  it("handles multiple wikilinks in same line", () => {
    expect(preprocessObsidian("See [[A]] and [[B]]")).toBe("See **A** and **B**");
  });

  it("passes through standard markdown unchanged", () => {
    const input = "# Heading\n\nParagraph with **bold** and *italic*.";
    expect(preprocessObsidian(input)).toBe(input);
  });

  it("handles content without frontmatter", () => {
    const input = "Just plain content";
    expect(preprocessObsidian(input)).toBe("Just plain content");
  });

  it("handles unclosed frontmatter gracefully", () => {
    const input = "---\nunclosed frontmatter\nContent here";
    expect(preprocessObsidian(input)).toBe(input);
  });
});

describe("VaultMarkdownPreview rendering", () => {
  it("renders single line breaks as <br> (remark-breaks)", () => {
    const { container } = render(<VaultMarkdownPreview content={"line1\nline2"} />);
    const br = container.querySelector("br");
    expect(br).toBeInTheDocument();
  });

  it("renders ==text== as <mark> highlight", () => {
    const { container } = render(<VaultMarkdownPreview content="This is ==highlighted== text" />);
    const mark = container.querySelector("mark");
    expect(mark).toBeInTheDocument();
    expect(mark).toHaveTextContent("highlighted");
  });

  it("renders > [!NOTE] as a callout (not plain blockquote)", () => {
    const { container } = render(
      <VaultMarkdownPreview content={"> [!NOTE]\n> This is a note callout"} />,
    );
    // rehype-callouts renders callouts as <div> with callout class, not <blockquote>
    const callout = container.querySelector(".callout");
    expect(callout).toBeInTheDocument();
  });

  it("renders no-lang fenced code block as block style", () => {
    const { container } = render(<VaultMarkdownPreview content={"```\nsome code\n```"} />);
    const pre = container.querySelector("pre");
    expect(pre).toBeInTheDocument();
    expect(pre).toHaveClass("bg-muted");
  });

  it("does not highlight ==text== inside fenced code blocks", () => {
    const { container } = render(
      <VaultMarkdownPreview content={"```\n==not highlighted==\n```"} />,
    );
    const mark = container.querySelector("mark");
    expect(mark).not.toBeInTheDocument();
  });

  it("preprocessObsidian + remark-breaks: stripped comments don't create spurious <br>", () => {
    const { container } = render(<VaultMarkdownPreview content={"Before\n%%comment%%\nAfter"} />);
    // Comment stripped, but "Before" and "After" should both appear
    expect(container.textContent).toContain("Before");
    expect(container.textContent).toContain("After");
  });
});
