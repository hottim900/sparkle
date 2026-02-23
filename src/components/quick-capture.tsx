import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createItem, getTags } from "@/lib/api";
import { toast } from "sonner";
import type { ItemType, ItemPriority } from "@/lib/types";
import { ChevronDown, ChevronUp, Send, Sun, Moon, X } from "lucide-react";

interface QuickCaptureProps {
  onCreated?: () => void;
}

export function QuickCapture({ onCreated }: QuickCaptureProps) {
  const { theme, setTheme } = useTheme();
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<ItemType>("note");
  const [priority, setPriority] = useState<ItemPriority | "none">("none");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [allTags, setAllTags] = useState<string[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [source, setSource] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getTags()
      .then((res) => setAllTags(res.tags ?? []))
      .catch(() => {});
  }, []);

  const tagSuggestions = allTags.filter(
    (t) =>
      t.toLowerCase().includes(tagInput.toLowerCase()) &&
      !selectedTags.includes(t),
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags([...selectedTags, trimmed]);
    }
    setTagInput("");
    setShowTagSuggestions(false);
  };

  const removeTag = (tag: string) => {
    setSelectedTags(selectedTags.filter((t) => t !== tag));
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
        source: source.trim() || undefined,
      });
      setTitle("");
      setSelectedTags([]);
      setTagInput("");
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
        <>
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
              placeholder="來源（如 Discord、LINE）"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-40"
            />
          </div>

          <div className="flex flex-wrap gap-1 items-center">
            {selectedTags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button type="button" onClick={() => removeTag(tag)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            <div className="relative flex-1 min-w-32">
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
                    e.stopPropagation();
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
                      type="button"
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
        </>
      )}
    </div>
  );
}
