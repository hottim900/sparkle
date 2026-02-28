import { render, screen } from "@testing-library/react";
import { MarkdownPreview } from "../markdown-preview";

describe("MarkdownPreview", () => {
  it("renders plain text", () => {
    render(<MarkdownPreview content="Hello World" />);
    expect(screen.getByText("Hello World")).toBeInTheDocument();
  });

  it("renders headings", () => {
    render(<MarkdownPreview content={"# Heading 1\n## Heading 2\n### Heading 3"} />);
    expect(screen.getByText("Heading 1")).toBeInTheDocument();
    expect(screen.getByText("Heading 2")).toBeInTheDocument();
    expect(screen.getByText("Heading 3")).toBeInTheDocument();

    expect(screen.getByText("Heading 1").tagName).toBe("H1");
    expect(screen.getByText("Heading 2").tagName).toBe("H2");
    expect(screen.getByText("Heading 3").tagName).toBe("H3");
  });

  it("renders links with target=_blank", () => {
    render(<MarkdownPreview content="[Click here](https://example.com)" />);
    const link = screen.getByText("Click here");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders inline code", () => {
    render(<MarkdownPreview content="Use `console.log` for debugging" />);
    const code = screen.getByText("console.log");
    expect(code.tagName).toBe("CODE");
  });

  it("renders code blocks", () => {
    render(<MarkdownPreview content={"```js\nconst x = 1;\n```"} />);
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });

  it("renders blockquotes", () => {
    render(<MarkdownPreview content="> This is a quote" />);
    const quote = screen.getByText("This is a quote");
    expect(quote.closest("blockquote")).toBeInTheDocument();
  });

  it("handles empty content without crashing", () => {
    const { container } = render(<MarkdownPreview content="" />);
    expect(container).toBeInTheDocument();
  });
});
