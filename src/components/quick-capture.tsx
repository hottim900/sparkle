import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createItem, getTags } from "@/lib/api";
import { TagInput } from "@/components/tag-input";
import { toast } from "sonner";
import type { ItemType, ItemPriority, ViewType } from "@/lib/types";
import { ChevronDown, ChevronUp, Send, Sun, Moon, StickyNote, Pin, Paperclip } from "lucide-react";

interface QuickCaptureProps {
  currentView: ViewType;
  onCreated?: () => void;
}

const gtdTags = [
  { tag: "next-action", label: "下一步" },
  { tag: "waiting-on", label: "等待中" },
  { tag: "someday", label: "有一天" },
];

const typeOptions: { value: ItemType; icon: typeof StickyNote; label: string }[] = [
  { value: "note", icon: StickyNote, label: "筆記" },
  { value: "todo", icon: Pin, label: "待辦" },
  { value: "scratch", icon: Paperclip, label: "暫存" },
];

function viewToDefaultType(view: ViewType): ItemType {
  if (["todos", "active", "done"].includes(view)) return "todo";
  if (["scratch", "draft"].includes(view)) return "scratch";
  return "note";
}

export function QuickCapture({ currentView, onCreated }: QuickCaptureProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState(false);
  const defaultType = viewToDefaultType(currentView);
  const [type, setType] = useState<ItemType>(defaultType);
  const [priority, setPriority] = useState<ItemPriority | "none">("none");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getTags()
      .then((res) => setAllTags(res.tags ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setType(viewToDefaultType(currentView));
  }, [currentView]);

  const addTag = (tag: string) => {
    setSelectedTags((prev) => [...prev, tag]);
  };

  const removeTag = (tag: string) => {
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
  };

  const toggleGtdTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      removeTag(tag);
    } else {
      addTag(tag);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    try {
      await createItem({
        title: trimmed,
        type,
        priority: priority === "none" ? null : priority,
        tags: selectedTags,
        source: source.trim() || null,
      });
      setTitle("");
      setSelectedTags([]);
      setSource("");
      setPriority("none");
      setExpanded(false);
      toast.success("已新增");
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "新增失敗");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="border-b bg-card p-3 space-y-2">
      {/* Type segmented control */}
      <div className="flex gap-1">
        {typeOptions.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant={type === opt.value ? "default" : "ghost"}
            className="h-7 gap-1 text-xs flex-1"
            onClick={() => setType(opt.value)}
          >
            <opt.icon className="h-3.5 w-3.5" />
            {opt.label}
          </Button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          placeholder={
            type === "todo" ? "新增待辦..." :
            type === "scratch" ? "暫存筆記..." :
            "快速記錄..."
          }
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          className="shrink-0 md:hidden"
        >
          {resolvedTheme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setExpanded(!expanded)}
          className="shrink-0"
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="submit"
          size="icon"
          disabled={!title.trim() || submitting}
          className="shrink-0"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>

      {expanded && (
        <>
          <div className="flex gap-2 flex-wrap">
            {type !== "scratch" && (
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as ItemPriority | "none")}
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
            )}

            <Input
              type="url"
              placeholder="參考連結 (URL)"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-48"
            />
          </div>

          {/* GTD quick-select for todos */}
          {type === "todo" && (
            <div className="flex gap-1">
              {gtdTags.map((gtd) => (
                <Button
                  key={gtd.tag}
                  type="button"
                  size="sm"
                  variant={selectedTags.includes(gtd.tag) ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => toggleGtdTag(gtd.tag)}
                >
                  {gtd.label}
                </Button>
              ))}
            </div>
          )}

          {type !== "scratch" && (
            <TagInput
              tags={selectedTags}
              allTags={allTags}
              onAdd={addTag}
              onRemove={removeTag}
            />
          )}
        </>
      )}
    </div>
  );
}
