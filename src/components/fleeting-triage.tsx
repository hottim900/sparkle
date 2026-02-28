import { useEffect, useState, useCallback } from "react";
import { listItems, updateItem, getTags } from "@/lib/api";
import { parseItems, type ParsedItem } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { TagInput } from "@/components/tag-input";
import { toast } from "sonner";
import {
  Pencil,
  PlayCircle,
  Archive,
  SkipForward,
  Sparkles,
  Loader2,
  FileText,
  ListTodo,
} from "lucide-react";

interface FleetingTriageProps {
  onDone?: () => void;
}

interface PendingChanges {
  type?: "note" | "todo";
  tags?: string[];
}

export function FleetingTriage({ onDone }: FleetingTriageProps) {
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingChanges>({});
  const [allTags, setAllTags] = useState<string[]>([]);

  const fetchFleeting = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listItems({ status: "fleeting", limit: 100 });
      setItems(parseItems(res.items));
      setCurrentIndex(0);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFleeting();
    getTags()
      .then((res) => setAllTags(res.tags))
      .catch(() => {});
  }, [fetchFleeting]);

  const current = items[currentIndex];
  const remaining = items.length - currentIndex;

  // Resolved values: pending overrides current
  const resolvedType = pending.type ?? current?.type ?? "note";
  const resolvedTags = pending.tags ?? current?.tags ?? [];
  const resetAndNext = () => {
    setPending({});
    if (currentIndex + 1 >= items.length) {
      toast.success("閃念筆記已處理完畢！");
      onDone?.();
    } else {
      setCurrentIndex((i) => i + 1);
    }
  };

  // Primary action: note→developing, todo→active
  const handlePrimaryAction = async () => {
    if (!current) return;
    try {
      const updates: Record<string, unknown> = {};
      const targetType = pending.type ?? current.type;
      // note → developing, todo → active
      updates.status = targetType === "note" ? "developing" : "active";
      if (pending.type !== undefined) updates.type = pending.type;
      if (pending.tags !== undefined) updates.tags = pending.tags;
      await updateItem(current.id, updates);
      toast.success(targetType === "note" ? "已設為發展中" : "已設為進行中");
      resetAndNext();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "操作失敗");
    }
  };

  const handleArchive = async () => {
    if (!current) return;
    try {
      const updates: Record<string, unknown> = { status: "archived" };
      if (pending.type !== undefined) updates.type = pending.type;
      if (pending.tags !== undefined) updates.tags = pending.tags;
      await updateItem(current.id, updates);
      toast.success("已封存");
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
        <Sparkles className="h-10 w-10 mb-2" />
        <p className="text-sm">閃念筆記已處理完畢</p>
        <Button variant="outline" className="mt-4" onClick={onDone}>
          返回
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4">
      {/* Progress */}
      <div className="text-center text-sm text-muted-foreground">剩餘 {remaining} 項</div>

      {/* Card */}
      <div className="border rounded-lg p-5 space-y-3">
        <h2 className="text-lg font-semibold">{current.title}</h2>
        {current.content && (
          <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-4">
            {current.content}
          </p>
        )}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {current.origin && <span>來源: {current.origin}</span>}
          <span>{new Date(current.created).toLocaleString("zh-TW")}</span>
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
              allTags={allTags}
              onAdd={addTag}
              onRemove={removeTag}
              placeholder="輸入標籤"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 justify-center">
        <Button onClick={handlePrimaryAction} className="gap-1">
          {resolvedType === "note" ? (
            <>
              <Pencil className="h-4 w-4" />
              發展
            </>
          ) : (
            <>
              <PlayCircle className="h-4 w-4" />
              進行
            </>
          )}
        </Button>
        <Button variant="outline" onClick={handleArchive} className="gap-1">
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
