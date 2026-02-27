import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => <h1 className="text-2xl font-bold mt-4 mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-xl font-bold mt-3 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-lg font-semibold mt-2 mb-1">{children}</h3>,
        p: ({ children }) => <p className="my-2">{children}</p>,
        ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        code: ({ className, children }) => {
          const isBlock = className?.includes("language-");
          return isBlock ? (
            <pre className="bg-muted rounded-md p-3 my-2 overflow-x-auto">
              <code className="text-sm font-mono">{children}</code>
            </pre>
          ) : (
            <code className="bg-muted px-1 py-0.5 rounded text-sm font-mono">{children}</code>
          );
        },
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-muted-foreground/30 pl-4 my-2 italic text-muted-foreground">{children}</blockquote>
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
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:no-underline">{children}</a>
        ),
        hr: () => <hr className="my-4 border-border" />,
        img: ({ src, alt }) => (
          <img src={src} alt={alt} className="max-w-full rounded-md my-2" />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
