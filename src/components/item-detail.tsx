import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  updateItem,
  deleteItem,
  getItem,
  getTags,
} from "@/lib/api";
import { parseItem, type ParsedItem } from "@/lib/types";
import { TagInput } from "@/components/tag-input";
import { toast } from "sonner";
import { Trash2, ArrowLeft, Eye, Pencil, Loader2, Check } from "lucide-react";

interface ItemDetailProps {
  itemId: string;
  onClose?: () => void;
  onUpdated?: () => void;
  onDeleted?: () => void;
}

export function ItemDetail({
  itemId,
  onClose,
  onUpdated,
  onDeleted,
}: ItemDetailProps) {
  const [item, setItem] = useState<ParsedItem | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [previewMode, setPreviewMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setLoading(true);
    Promise.all([getItem(itemId), getTags()])
      .then(([itemData, tagsData]) => {
        setItem(parseItem(itemData));
        setAllTags(tagsData.tags);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "載入失敗");
      })
      .finally(() => setLoading(false));
  }, [itemId]);

  const saveField = useCallback(
    async (field: string, value: unknown) => {
      if (!item) return;
      setSaveStatus("saving");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      try {
        const updated = await updateItem(item.id, { [field]: value });
        setItem(parseItem(updated));
        onUpdated?.();
        setSaveStatus("saved");
        savedTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (err) {
        setSaveStatus("idle");
        toast.error(err instanceof Error ? err.message : "儲存失敗");
      }
    },
    [item, onUpdated],
  );

  const debouncedSave = useCallback(
    (field: string, value: unknown) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => saveField(field, value), 500);
    },
    [saveField],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleDelete = async () => {
    if (!item) return;
    try {
      await deleteItem(item.id);
      toast.success("已刪除");
      setDeleteOpen(false);
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const addTag = (tag: string) => {
    if (!item) return;
    const newTags = [...item.tags, tag];
    setItem({ ...item, tags: newTags });
    saveField("tags", newTags);
  };

  const removeTag = (tag: string) => {
    if (!item) return;
    const newTags = item.tags.filter((t) => t !== tag);
    setItem({ ...item, tags: newTags });
    saveField("tags", newTags);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">載入中...</p>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">找不到項目</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-1">
          {saveStatus === "saving" && (
            <span className="text-xs text-muted-foreground flex items-center gap-1 animate-fade-in">
              <Loader2 className="h-3 w-3 animate-spin" />
              儲存中...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-xs text-muted-foreground flex items-center gap-1 animate-fade-in">
              <Check className="h-3 w-3" />
              已儲存
            </span>
          )}
        </div>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>確認刪除</DialogTitle>
              <DialogDescription>
                確定要刪除「{item.title}」嗎？此操作無法復原。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                取消
              </Button>
              <Button variant="destructive" onClick={handleDelete}>
                刪除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 animate-fade-in">
        {/* Title */}
        <Input
          value={item.title}
          onChange={(e) => {
            setItem({ ...item, title: e.target.value });
            debouncedSave("title", e.target.value);
          }}
          onBlur={() => {
            if (saveTimeoutRef.current) {
              clearTimeout(saveTimeoutRef.current);
              saveField("title", item.title);
            }
          }}
          className="text-lg font-semibold border-0 px-0 focus-visible:ring-0"
          placeholder="標題"
        />

        {/* Type + Status + Priority row */}
        <div className="flex gap-2 flex-wrap">
          <Select
            value={item.type}
            onValueChange={(v) => {
              setItem({ ...item, type: v as ParsedItem["type"] });
              saveField("type", v);
            }}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="note">筆記</SelectItem>
              <SelectItem value="todo">待辦</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={item.status}
            onValueChange={(v) => {
              setItem({ ...item, status: v as ParsedItem["status"] });
              saveField("status", v);
            }}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inbox">收件匣</SelectItem>
              <SelectItem value="active">進行中</SelectItem>
              <SelectItem value="done">完成</SelectItem>
              <SelectItem value="archived">封存</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={item.priority ?? "none"}
            onValueChange={(v) => {
              const val = v === "none" ? null : v;
              setItem({
                ...item,
                priority: val as ParsedItem["priority"],
              });
              saveField("priority", val);
            }}
          >
            <SelectTrigger className="w-24">
              <SelectValue placeholder="優先度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">無</SelectItem>
              <SelectItem value="low">低</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="high">高</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Due date */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            到期日
          </label>
          <Input
            type="date"
            value={item.due_date ?? ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setItem({ ...item, due_date: val });
              saveField("due_date", val);
            }}
          />
        </div>

        {/* Source */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            來源
          </label>
          <Input
            value={item.source}
            onChange={(e) => {
              setItem({ ...item, source: e.target.value });
              debouncedSave("source", e.target.value);
            }}
            onBlur={() => {
              if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveField("source", item.source);
              }
            }}
            placeholder="例如：from Discord"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            標籤
          </label>
          <TagInput
            tags={item.tags}
            allTags={allTags}
            onAdd={addTag}
            onRemove={removeTag}
          />
        </div>

        {/* Content / Markdown */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm text-muted-foreground">
              內容
            </label>
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
          {previewMode ? (
            <div className="min-h-[240px] rounded-md border p-3 text-sm">
              {item.content ? (
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
                  {item.content}
                </ReactMarkdown>
              ) : (
                <p className="text-muted-foreground">無內容</p>
              )}
            </div>
          ) : (
            <Textarea
              value={item.content}
              onChange={(e) => {
                setItem({ ...item, content: e.target.value });
                debouncedSave("content", e.target.value);
              }}
              onBlur={() => {
                if (saveTimeoutRef.current) {
                  clearTimeout(saveTimeoutRef.current);
                  saveField("content", item.content);
                }
              }}
              placeholder="Markdown 內容..."
              rows={10}
              className="font-mono text-sm"
            />
          )}
        </div>

        {/* Metadata */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>建立: {new Date(item.created_at).toLocaleString("zh-TW")}</p>
          <p>更新: {new Date(item.updated_at).toLocaleString("zh-TW")}</p>
        </div>
      </div>
    </div>
  );
}
