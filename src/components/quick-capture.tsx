import { useState } from "react";
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
import { createItem } from "@/lib/api";
import { toast } from "sonner";
import type { ItemType, ItemPriority } from "@/lib/types";
import { ChevronDown, ChevronUp, Send, Sun, Moon } from "lucide-react";

interface QuickCaptureProps {
  onCreated?: () => void;
}

export function QuickCapture({ onCreated }: QuickCaptureProps) {
  const { theme, setTheme } = useTheme();
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<ItemType>("note");
  const [priority, setPriority] = useState<ItemPriority | "none">("none");
  const [tags, setTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setTitle("");
      setTags("");
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
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          placeholder="快速記錄..."
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
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="shrink-0 md:hidden"
        >
          {theme === "dark" ? (
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
        <div className="flex gap-2 flex-wrap">
          <Select
            value={type}
            onValueChange={(v) => setType(v as ItemType)}
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

          <Input
            placeholder="標籤（逗號分隔）"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="flex-1 min-w-32"
          />
        </div>
      )}
    </div>
  );
}
