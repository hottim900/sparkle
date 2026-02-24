import { useEffect, useState, useCallback } from "react";
import { listItems, updateItem } from "@/lib/api";
import { parseItems, type ParsedItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TagInput } from "@/components/tag-input";
import { toast } from "sonner";
import {
  CheckCircle,
  Archive,
  SkipForward,
  Inbox,
  Loader2,
  FileText,
  ListTodo,
  X,
  Calendar,
} from "lucide-react";

interface InboxTriageProps {
  onDone?: () => void;
}

interface PendingChanges {
  type?: "note" | "todo";
  tags?: string[];
  due_date?: string | null;
}

function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTodayStr(): string {
  return toDateStr(new Date());
}

function getTomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

function getNextMondayStr(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

export function InboxTriage({ onDone }: InboxTriageProps) {
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingChanges>({});
  const [showDateInput, setShowDateInput] = useState(false);

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

  // Resolved values: pending overrides current
  const resolvedType = pending.type ?? current?.type ?? "note";
  const resolvedTags = pending.tags ?? current?.tags ?? [];
  const resolvedDueDate = pending.due_date !== undefined ? pending.due_date : (current?.due_date ?? null);

  const resetAndNext = () => {
    setPending({});
    setShowDateInput(false);
    if (currentIndex + 1 >= items.length) {
      toast.success("收件匣已清空！");
      onDone?.();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  const handleAction = async (action: "active" | "archived") => {
    if (!current) return;
    try {
      const updates: Record<string, unknown> = { status: action };
      if (pending.type !== undefined) updates.type = pending.type;
      if (pending.tags !== undefined) updates.tags = pending.tags;
      if (pending.due_date !== undefined) updates.due_date = pending.due_date;
      await updateItem(current.id, updates);
      toast.success(action === "active" ? "已設為進行中" : "已封存");
      resetAndNext();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失敗");
    }
  };

  const toggleType = () => {
    setPending((p) => ({
      ...p,
      type: resolvedType === "note" ? "todo" : "note",
    }));
  };

  const addTag = (tag: string) => {
    if (!resolvedTags.includes(tag)) {
      setPending((p) => ({ ...p, tags: [...resolvedTags, tag] }));
    }
  };

  const removeTag = (tag: string) => {
    setPending((p) => ({
      ...p,
      tags: resolvedTags.filter((t) => t !== tag),
    }));
  };

  const setDueDate = (date: string | null) => {
    setPending((p) => ({ ...p, due_date: date }));
    setShowDateInput(false);
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

  const todayStr = getTodayStr();
  const tomorrowStr = getTomorrowStr();
  const nextMondayStr = getNextMondayStr();

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      {/* Progress */}
      <div className="text-center text-sm text-muted-foreground">
        剩餘 {remaining} 項
      </div>

      {/* Card */}
      <div className="border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-semibold">{current.title}</h2>
        {current.content && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
            {current.content}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {current.source && <span>來源: {current.source}</span>}
          <span>{new Date(current.created_at).toLocaleString("zh-TW")}</span>
        </div>
      </div>

      {/* Properties */}
      <div className="border rounded-lg p-4 space-y-3">
        {/* Type toggle */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground w-10">類型</span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={resolvedType === "note" ? "default" : "outline"}
              className="gap-1 h-7 text-xs"
              onClick={toggleType}
            >
              <FileText className="h-3 w-3" />
              筆記
            </Button>
            <Button
              size="sm"
              variant={resolvedType === "todo" ? "default" : "outline"}
              className="gap-1 h-7 text-xs"
              onClick={toggleType}
            >
              <ListTodo className="h-3 w-3" />
              待辦
            </Button>
          </div>
        </div>

        {/* Tags */}
        <div className="flex items-start gap-2">
          <span className="text-sm text-muted-foreground w-10 pt-0.5">標籤</span>
          <div className="flex-1">
            <TagInput
              tags={resolvedTags}
              allTags={[]}
              onAdd={addTag}
              onRemove={removeTag}
              placeholder="輸入標籤"
            />
          </div>
        </div>

        {/* Due date */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground w-10">到期</span>
          {resolvedDueDate ? (
            <Badge variant="outline" className="gap-1">
              <Calendar className="h-3 w-3" />
              {resolvedDueDate}
              <button onClick={() => setDueDate(null)} className="ml-0.5 hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ) : (
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDueDate(todayStr)}>
                今天
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDueDate(tomorrowStr)}>
                明天
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDueDate(nextMondayStr)}>
                下週一
              </Button>
              {showDateInput ? (
                <input
                  type="date"
                  autoFocus
                  className="h-7 text-xs border rounded px-2 bg-background"
                  onChange={(e) => {
                    if (e.target.value) setDueDate(e.target.value);
                  }}
                  onBlur={() => setShowDateInput(false)}
                />
              ) : (
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDateInput(true)}>
                  自訂...
                </Button>
              )}
            </div>
          )}
        </div>
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
        <Button variant="ghost" onClick={resetAndNext} className="gap-1">
          <SkipForward className="h-4 w-4" />
          保留
        </Button>
      </div>
    </div>
  );
}
