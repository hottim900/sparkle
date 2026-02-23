import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";
import { Trash2, X, ArrowLeft, Eye, Pencil, Loader2, Check } from "lucide-react";

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
  const [tagInput, setTagInput] = useState("");
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
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
    if (!item || !tag.trim()) return;
    const trimmed = tag.trim();
    if (item.tags.includes(trimmed)) return;
    const newTags = [...item.tags, trimmed];
    setItem({ ...item, tags: newTags });
    saveField("tags", newTags);
    setTagInput("");
    setShowTagSuggestions(false);
  };

  const removeTag = (tag: string) => {
    if (!item) return;
    const newTags = item.tags.filter((t) => t !== tag);
    setItem({ ...item, tags: newTags });
    saveField("tags", newTags);
  };

  const renderMarkdown = useCallback((text: string): React.ReactNode[] => {
    if (!text) return [];
    const blocks = text.split(/\n\n+/);
    const nodes: React.ReactNode[] = [];

    const renderInline = (line: string): React.ReactNode[] => {
      const parts: React.ReactNode[] = [];
      const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let key = 0;
      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push(line.slice(lastIndex, match.index));
        }
        if (match[2]) {
          parts.push(<strong key={key++}>{match[2]}</strong>);
        } else if (match[3]) {
          parts.push(<em key={key++}>{match[3]}</em>);
        } else if (match[4]) {
          parts.push(
            <code key={key++} className="bg-muted px-1 py-0.5 rounded text-sm">
              {match[4]}
            </code>
          );
        }
        lastIndex = match.index + match[0].length;
      }
      if (lastIndex < line.length) {
        parts.push(line.slice(lastIndex));
      }
      return parts;
    };

    blocks.forEach((block, blockIdx) => {
      const trimmed = block.trim();
      if (!trimmed) return;

      // Headings
      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/m);
      if (headingMatch && trimmed.split("\n").length === 1) {
        const level = headingMatch[1]!.length;
        const content = renderInline(headingMatch[2]!);
        if (level === 1) nodes.push(<h1 key={blockIdx} className="text-2xl font-bold mt-4 mb-2">{content}</h1>);
        else if (level === 2) nodes.push(<h2 key={blockIdx} className="text-xl font-bold mt-3 mb-2">{content}</h2>);
        else nodes.push(<h3 key={blockIdx} className="text-lg font-semibold mt-2 mb-1">{content}</h3>);
        return;
      }

      // Unordered list
      const lines = trimmed.split("\n");
      if (lines.every((l) => /^[-*]\s+/.test(l.trim()))) {
        nodes.push(
          <ul key={blockIdx} className="list-disc pl-5 my-2 space-y-1">
            {lines.map((l, i) => (
              <li key={i}>{renderInline(l.trim().replace(/^[-*]\s+/, ""))}</li>
            ))}
          </ul>
        );
        return;
      }

      // Regular paragraph (with line breaks)
      nodes.push(
        <p key={blockIdx} className="my-2">
          {lines.map((l, i) => (
            <span key={i}>
              {renderInline(l)}
              {i < lines.length - 1 && <br />}
            </span>
          ))}
        </p>
      );
    });

    return nodes;
  }, []);

  const tagSuggestions = allTags.filter(
    (t) =>
      t.toLowerCase().includes(tagInput.toLowerCase()) &&
      !item?.tags.includes(t),
  );

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
          <div className="flex flex-wrap gap-1 mb-2">
            {item.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button onClick={() => removeTag(tag)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="relative">
            <Input
              placeholder="新增標籤..."
              value={tagInput}
              onChange={(e) => {
                setTagInput(e.target.value);
                setShowTagSuggestions(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              onFocus={() => setShowTagSuggestions(true)}
              onBlur={() =>
                setTimeout(() => setShowTagSuggestions(false), 200)
              }
            />
            {showTagSuggestions && tagInput && tagSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-popover border rounded-md shadow-md z-10 mt-1">
                {tagSuggestions.slice(0, 5).map((tag) => (
                  <button
                    key={tag}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      addTag(tag);
                    }}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>
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
                renderMarkdown(item.content)
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
