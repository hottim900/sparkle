import { useState, lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/error-boundary";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Eye, Pencil, Loader2 } from "lucide-react";

const MarkdownPreview = lazy(() =>
  import("@/components/markdown-preview").then((m) => ({ default: m.MarkdownPreview })),
);

interface ItemContentEditorProps {
  content: string;
  onChange: (content: string) => void;
  onBlur: () => void;
  offlineWarning?: boolean;
}

export function ItemContentEditor({
  content,
  onChange,
  onBlur,
  offlineWarning,
}: ItemContentEditorProps) {
  const [previewMode, setPreviewMode] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm text-muted-foreground">內容</label>
        <div className="flex gap-1">
          <Button
            variant={previewMode ? "ghost" : "secondary"}
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setPreviewMode(false)}
          >
            <Pencil className="h-3 w-3" />
            編輯
          </Button>
          <Button
            variant={previewMode ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setPreviewMode(true)}
          >
            <Eye className="h-3 w-3" />
            預覽
          </Button>
        </div>
      </div>
      {offlineWarning && !previewMode && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400 mb-1">
          離線中 — 編輯內容將不會自動儲存
        </p>
      )}
      {previewMode ? (
        <div className="min-h-[240px] rounded-md border p-3 text-sm break-words">
          {content ? (
            <ErrorBoundary>
              <Suspense
                fallback={
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                }
              >
                <MarkdownPreview content={content} />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <p className="text-muted-foreground">無內容</p>
          )}
        </div>
      ) : (
        <Textarea
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder="Markdown 內容..."
          rows={10}
          className="font-mono text-sm"
        />
      )}
    </div>
  );
}
