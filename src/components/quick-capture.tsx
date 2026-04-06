import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createItem, getTags } from "@/lib/api";
import { TagInput } from "@/components/tag-input";
import { useAppContext } from "@/lib/app-context";
import { queryKeys } from "@/lib/query-keys";
import { useInvalidateAfterItemMutation } from "@/hooks/use-invalidate";
import { toast } from "sonner";
import type { ItemType, ItemPriority } from "@/lib/types";
import {
  ChevronDown,
  ChevronUp,
  Send,
  Sun,
  Moon,
  StickyNote,
  Pin,
  Paperclip,
  Loader2,
} from "lucide-react";

const KEYBOARD_HINT_KEY = "sparkle:quickcapture:submissions";
const KEYBOARD_HINT_DISMISS_AFTER = 5;

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

function pathToDefaultType(pathname: string): ItemType {
  if (pathname.startsWith("/todos")) return "todo";
  if (pathname.startsWith("/scratch")) return "scratch";
  return "note";
}

function safeStorage(key: string, fallback = "0"): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function useShowKeyboardHint() {
  const [show, setShow] = useState(() => {
    const count = parseInt(safeStorage(KEYBOARD_HINT_KEY), 10);
    return count < KEYBOARD_HINT_DISMISS_AFTER;
  });
  const increment = () => {
    const next = parseInt(safeStorage(KEYBOARD_HINT_KEY), 10) + 1;
    try {
      localStorage.setItem(KEYBOARD_HINT_KEY, String(next));
    } catch {
      /* Safari private browsing or quota exceeded */
    }
    if (next >= KEYBOARD_HINT_DISMISS_AFTER) setShow(false);
  };
  return { show, increment };
}

function useIsDesktop() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(hover: hover)").matches
    : false;
}

export function QuickCapture() {
  const { isOnline } = useAppContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { resolvedTheme, setTheme } = useTheme();
  const invalidateAfterItemMutation = useInvalidateAfterItemMutation();
  const isDesktop = useIsDesktop();
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const defaultType = pathToDefaultType(pathname);
  const [type, setType] = useState<ItemType>(defaultType);
  const [priority, setPriority] = useState<ItemPriority | "none">("none");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const keyboardHint = useShowKeyboardHint();

  const usesTextarea = type !== "todo";

  const { data: allTags = [] } = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => getTags().then((r) => r.tags ?? []),
  });

  const createMutation = useMutation({
    mutationFn: createItem,
    onSuccess: () => invalidateAfterItemMutation(),
  });

  useEffect(() => {
    setType(pathToDefaultType(pathname));
  }, [pathname]);

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
    const trimmed = text.trim();
    if (!trimmed || createMutation.isPending) return;

    try {
      const payload: Parameters<typeof createItem>[0] = {
        type,
        priority: priority === "none" ? null : priority,
        tags: selectedTags,
        source: source.trim() || null,
        origin: "app",
      };

      if (usesTextarea) {
        // note/scratch: send content, server derives title
        payload.content = trimmed;
      } else {
        // todo: send title directly
        payload.title = trimmed;
      }

      await createMutation.mutateAsync(payload);
      setText("");
      setSelectedTags([]);
      setSource("");
      setPriority("none");
      setExpanded(false);
      keyboardHint.increment();
      toast.success("已新增");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "新增失敗");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (usesTextarea) {
      // Textarea: Cmd/Ctrl+Enter to submit
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
      // Enter alone = newline (default textarea behavior, no preventDefault)
    } else {
      // Input (todo): Enter to submit
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
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
        {usesTextarea ? (
          <Textarea
            ref={textareaRef}
            placeholder={type === "scratch" ? "暫存筆記..." : "打下你的想法... 第一行會成為標題"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            rows={1}
            className="flex-1 min-h-9 max-h-[min(40vh,200px)] overflow-y-auto resize-none"
          />
        ) : (
          <Input
            placeholder="新增待辦..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="flex-1"
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          aria-label="切換主題"
          title="切換主題"
          className="shrink-0 md:hidden"
        >
          {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "收合" : "展開"}
          title={expanded ? "收合" : "展開"}
          className="shrink-0"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || createMutation.isPending}
          aria-label="送出"
          title="送出"
          className="shrink-0"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </form>

      {/* Keyboard hint — desktop only, dismiss after N submissions */}
      {usesTextarea && isDesktop && keyboardHint.show && (
        <p className="text-xs text-muted-foreground px-1">Enter 換行 | ⌘+Enter 送出</p>
      )}

      {!isOnline && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400 px-1">
          離線模式 — 提交後將在連線時自動同步
        </p>
      )}

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
            <TagInput tags={selectedTags} allTags={allTags} onAdd={addTag} onRemove={removeTag} />
          )}
        </>
      )}
    </div>
  );
}
