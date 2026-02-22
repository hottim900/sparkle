import { useEffect, useState, useCallback } from "react";
import { listItems, updateItem } from "@/lib/api";
import { parseItems, type ParsedItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  CheckCircle,
  Archive,
  SkipForward,
  Inbox,
  Loader2,
} from "lucide-react";

interface InboxTriageProps {
  onDone?: () => void;
}

export function InboxTriage({ onDone }: InboxTriageProps) {
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [tagInput, setTagInput] = useState("");

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listItems({ status: "inbox", limit: 100 });
      setItems(parseItems(res.items));
      setCurrentIndex(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const current = items[currentIndex];
  const remaining = items.length - currentIndex;

  const handleAction = async (
    action: "active" | "archived",
    extraTags?: string[],
  ) => {
    if (!current) return;
    try {
      const updates: Record<string, unknown> = { status: action };
      if (extraTags && extraTags.length > 0) {
        const existingTags = current.tags;
        updates.tags = [...new Set([...existingTags, ...extraTags])];
      }
      await updateItem(current.id, updates);
      toast.success(action === "active" ? "已設為進行中" : "已封存");
      next();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失敗");
    }
  };

  const next = () => {
    setTagInput("");
    if (currentIndex + 1 >= items.length) {
      toast.success("收件匣已清空！");
      onDone?.();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const addTagAndActivate = () => {
    const tags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    handleAction("active", tags);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!current || remaining <= 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Inbox className="h-10 w-10 mb-2" />
        <p className="text-sm">收件匣已清空</p>
        <Button variant="outline" className="mt-4" onClick={onDone}>
          返回
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-6">
      {/* Progress */}
      <div className="text-center text-sm text-muted-foreground">
        剩餘 {remaining} 項
      </div>

      {/* Card */}
      <div className="border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">{current.title}</h2>
        {current.content && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">
            {current.content}
          </p>
        )}
        {current.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {current.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {current.source && (
          <p className="text-xs text-muted-foreground">
            來源: {current.source}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {new Date(current.created_at).toLocaleString("zh-TW")}
        </p>
      </div>

      {/* Tag input */}
      <div className="flex gap-2">
        <Input
          placeholder="加標籤（逗號分隔）"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTagAndActivate();
            }
          }}
          className="flex-1"
        />
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-center">
        <Button onClick={() => handleAction("active")} className="gap-1">
          <CheckCircle className="h-4 w-4" />
          進行中
        </Button>
        <Button
          variant="outline"
          onClick={() => handleAction("archived")}
          className="gap-1"
        >
          <Archive className="h-4 w-4" />
          封存
        </Button>
        <Button variant="ghost" onClick={next} className="gap-1">
          <SkipForward className="h-4 w-4" />
          跳過
        </Button>
      </div>
    </div>
  );
}
