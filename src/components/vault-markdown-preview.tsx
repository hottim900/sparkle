import ReactMarkdown from "react-markdown";
import { remarkPlugins, rehypePlugins, sharedComponents } from "@/lib/markdown-config";

interface VaultMarkdownPreviewProps {
  content: string;
}

/**
 * Pre-process Obsidian-specific syntax before passing to ReactMarkdown.
 * - Wikilinks [[target]] or [[target|alias]] → styled text
 * - Embeds ![[filename]] → placeholder
 * - Comments %%...%% → stripped
 * - Images → alt text only (no image serving)
 */
function preprocessObsidian(raw: string): string {
  let text = raw;

  // Strip Obsidian comments %%...%%  (single and multi-line)
  text = text.replace(/%%[\s\S]*?%%/g, "");

  // Replace embeds ![[filename]] with placeholder
  text = text.replace(/!\[\[([^\]]+)\]\]/g, (_match, name: string) => `[內嵌：${name}]`);

  // Replace wikilinks [[target|alias]] or [[target]] with styled text
  text = text.replace(
    /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
    (_match, _target: string, alias: string) => `**${alias}**`,
  );
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_match, target: string) => `**${target}**`);

  // Strip frontmatter if present
  if (text.startsWith("---\n")) {
    const endIdx = text.indexOf("\n---", 4);
    if (endIdx !== -1) {
      text = text.slice(endIdx + 4).replace(/^\n+/, "");
    }
  }

  return text;
}

export function VaultMarkdownPreview({ content }: VaultMarkdownPreviewProps) {
  const processed = preprocessObsidian(content);

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{
        ...sharedComponents,
        h1: ({ children }) => <h1 className="text-2xl font-bold mt-4 mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xl font-bold mt-3 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-lg font-semibold mt-2 mb-1">{children}</h3>,
        p: ({ children }) => <p className="my-2">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-2 italic text-muted-foreground">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="border-b-2 border-border">{children}</thead>,
        th: ({ children }) => <th className="text-left p-2 font-semibold">{children}</th>,
        td: ({ children }) => <td className="p-2 border-b border-border">{children}</td>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline hover:no-underline"
          >
            {children}
          </a>
        ),
        hr: () => <hr className="my-4 border-border" />,
        // Suppress images — show alt text instead
        img: ({ alt }) => (
          <span className="text-muted-foreground italic">[圖片：{alt || "無描述"}]</span>
        ),
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}

export { preprocessObsidian };
