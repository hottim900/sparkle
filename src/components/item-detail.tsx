import { useState, useEffect, useCallback, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  exportItem,
  createItem,
  getLinkedTodos,
} from "@/lib/api";
import { parseItem, parseItems, type ParsedItem, type ItemStatus, type ItemPriority } from "@/lib/types";
import { TagInput } from "@/components/tag-input";
import { toast } from "sonner";
import {
  Trash2,
  ArrowLeft,
  Eye,
  Pencil,
  Loader2,
  Check,
  ExternalLink,
  X,
  ListTodo,
  FileText,
  Plus,
} from "lucide-react";

interface ItemDetailProps {
  itemId: string;
  obsidianEnabled?: boolean;
  onClose?: () => void;
  onUpdated?: () => void;
  onDeleted?: () => void;
  onNavigate?: (itemId: string) => void;
}

const noteStatuses: { value: ItemStatus; label: string }[] = [
  { value: "fleeting", label: "閃念" },
  { value: "developing", label: "發展中" },
  { value: "permanent", label: "永久筆記" },
  { value: "archived", label: "已封存" },
];

const todoStatuses: { value: ItemStatus; label: string }[] = [
  { value: "active", label: "進行中" },
  { value: "done", label: "已完成" },
  { value: "archived", label: "已封存" },
];

const gtdTags = [
  { tag: "next-action", label: "下一步" },
  { tag: "waiting-on", label: "等待中" },
  { tag: "someday", label: "有一天" },
];

export function ItemDetail({
  itemId,
  obsidianEnabled,
  onClose,
  onUpdated,
  onDeleted,
  onNavigate,
}: ItemDetailProps) {
  const [item, setItem] = useState<ParsedItem | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [aliasInput, setAliasInput] = useState("");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Linked todo state
  const [showCreateTodo, setShowCreateTodo] = useState(false);
  const [linkedTodoTitle, setLinkedTodoTitle] = useState("");
  const [linkedTodoDue, setLinkedTodoDue] = useState("");
  const [linkedTodoPriority, setLinkedTodoPriority] = useState<ItemPriority | "none">("none");
  const [linkedTodoTags, setLinkedTodoTags] = useState<string[]>([]);
  const [creatingTodo, setCreatingTodo] = useState(false);
  const [linkedTodos, setLinkedTodos] = useState<ParsedItem[]>([]);
  const [linkedTodosLoading, setLinkedTodosLoading] = useState(false);
  const [linkedNoteTitle, setLinkedNoteTitle] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setShowCreateTodo(false);
    setLinkedNoteTitle(null);
    Promise.all([getItem(itemId), getTags()])
      .then(([itemData, tagsData]) => {
        const parsed = parseItem(itemData);
        setItem(parsed);
        setAllTags(tagsData.tags);
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "載入失敗");
      })
      .finally(() => setLoading(false));
  }, [itemId]);

  // Fetch linked todos for notes
  const loadLinkedTodos = useCallback(async () => {
    if (!item || item.type !== "note") return;
    setLinkedTodosLoading(true);
    try {
      const res = await getLinkedTodos(item.id);
      setLinkedTodos(parseItems(res.items));
    } catch {
      // silently fail — section just won't show data
    } finally {
      setLinkedTodosLoading(false);
    }
  }, [item?.id, item?.type]);

  useEffect(() => {
    if (item?.type === "note") {
      loadLinkedTodos();
    }
  }, [item?.id, item?.type, loadLinkedTodos]);

  // Fetch linked note title for backlink display on todos
  useEffect(() => {
    if (item?.type === "todo" && item.linked_note_id) {
      getItem(item.linked_note_id)
        .then((noteData) => setLinkedNoteTitle(noteData.title))
        .catch(() => setLinkedNoteTitle(null));
    }
  }, [item?.type, item?.linked_note_id]);

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

  const handleExport = async () => {
    if (!item) return;
    setExporting(true);
    try {
      const result = await exportItem(item.id);
      toast.success(`已匯出到 Obsidian: ${result.path}`);
      // Refresh item to get updated status
      const updated = await getItem(item.id);
      setItem(parseItem(updated));
      onUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "匯出失敗");
    } finally {
      setExporting(false);
    }
  };

  const handleCreateLinkedTodo = async () => {
    if (!item || creatingTodo) return;
    const trimmedTitle = linkedTodoTitle.trim();
    if (!trimmedTitle) return;
    setCreatingTodo(true);
    try {
      await createItem({
        title: trimmedTitle,
        type: "todo",
        priority: linkedTodoPriority === "none" ? null : linkedTodoPriority,
        due: linkedTodoDue || null,
        tags: linkedTodoTags,
        linked_note_id: item.id,
      });
      toast.success("已建立關聯待辦");
      setShowCreateTodo(false);
      setLinkedTodoTitle("");
      setLinkedTodoDue("");
      setLinkedTodoPriority("none");
      setLinkedTodoTags([]);
      loadLinkedTodos();
      onUpdated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setCreatingTodo(false);
    }
  };

  const openCreateTodoForm = () => {
    if (!item) return;
    setLinkedTodoTitle(`處理：${item.title}`);
    setLinkedTodoDue("");
    setLinkedTodoPriority("none");
    setLinkedTodoTags([...item.tags]);
    setShowCreateTodo(true);
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

  const addAlias = (alias: string) => {
    if (!item) return;
    const trimmed = alias.trim();
    if (!trimmed || item.aliases.includes(trimmed)) return;
    const newAliases = [...item.aliases, trimmed];
    setItem({ ...item, aliases: newAliases });
    saveField("aliases", newAliases);
    setAliasInput("");
  };

  const removeAlias = (alias: string) => {
    if (!item) return;
    const newAliases = item.aliases.filter((a) => a !== alias);
    setItem({ ...item, aliases: newAliases });
    saveField("aliases", newAliases);
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

  const statusOptions = item.type === "note" ? noteStatuses : todoStatuses;
  const showExportButton =
    obsidianEnabled && item.type === "note" && item.status === "permanent";

  return (
    <div className="h-full flex flex-col min-w-0">
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
        <div className="flex items-center gap-1">
          {item.type === "note" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={openCreateTodoForm}
            >
              <ListTodo className="h-3 w-3" />
              建立追蹤待辦
            </Button>
          )}
          {showExportButton && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ExternalLink className="h-3 w-3" />
              )}
              匯出到 Obsidian
            </Button>
          )}
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
      </div>

      {/* Type indicator bar */}
      <div
        className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium ${
          item.type === "note"
            ? "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
            : "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
        }`}
      >
        {item.type === "note" ? (
          <FileText className="h-3.5 w-3.5" />
        ) : (
          <ListTodo className="h-3.5 w-3.5" />
        )}
        {item.type === "note" ? "筆記" : "待辦"}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 animate-fade-in break-words">
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
              // Type conversion — server handles status auto-mapping
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
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
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

        {/* Due date (todo only) */}
        {item.type === "todo" && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">
              到期日
            </label>
            <Input
              type="date"
              value={item.due ?? ""}
              onChange={(e) => {
                const val = e.target.value || null;
                setItem({ ...item, due: val });
                saveField("due", val);
              }}
            />
          </div>
        )}

        {/* Backlink to linked note (todo only) */}
        {item.type === "todo" && item.linked_note_id && linkedNoteTitle && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">
              關聯筆記
            </label>
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
              onClick={() => onNavigate?.(item.linked_note_id!)}
            >
              <FileText className="h-3.5 w-3.5" />
              {linkedNoteTitle}
            </button>
          </div>
        )}

        {/* Source URL */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            參考連結
          </label>
          <Input
            type="url"
            value={item.source ?? ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setItem({ ...item, source: val });
              debouncedSave("source", val);
            }}
            onBlur={() => {
              if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
                saveField("source", item.source);
              }
            }}
            placeholder="https://..."
          />
        </div>

        {/* Origin (read-only) */}
        {item.origin && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">
              捕捉來源
            </label>
            <p className="text-sm px-3 py-2 bg-muted rounded-md">{item.origin}</p>
          </div>
        )}

        {/* Tags */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            標籤
          </label>
          {/* GTD quick-select buttons for todos */}
          {item.type === "todo" && (
            <div className="flex gap-1 mb-2">
              {gtdTags.map((gtd) => {
                const isActive = item.tags.includes(gtd.tag);
                return (
                  <Button
                    key={gtd.tag}
                    size="sm"
                    variant={isActive ? "default" : "outline"}
                    className="h-7 text-xs"
                    onClick={() => {
                      if (isActive) {
                        removeTag(gtd.tag);
                      } else {
                        addTag(gtd.tag);
                      }
                    }}
                  >
                    {gtd.label}
                  </Button>
                );
              })}
            </div>
          )}
          <TagInput
            tags={item.tags}
            allTags={allTags}
            onAdd={addTag}
            onRemove={removeTag}
          />
        </div>

        {/* Aliases */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">
            別名
          </label>
          <div className="flex flex-wrap gap-1 mb-2">
            {item.aliases.map((alias) => (
              <Badge key={alias} variant="secondary" className="gap-1">
                {alias}
                <button type="button" onClick={() => removeAlias(alias)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <Input
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAlias(aliasInput);
              }
            }}
            placeholder="新增別名..."
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
            <div className="min-h-[240px] rounded-md border p-3 text-sm break-words">
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

        {/* Create linked todo inline form (note only) */}
        {item.type === "note" && showCreateTodo && (
          <div className="rounded-md border p-3 space-y-3 bg-muted/30">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                建立追蹤待辦
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setShowCreateTodo(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Input
              value={linkedTodoTitle}
              onChange={(e) => setLinkedTodoTitle(e.target.value)}
              placeholder="待辦標題"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateLinkedTodo();
                }
              }}
            />
            <div className="flex gap-2 flex-wrap">
              <Input
                type="date"
                value={linkedTodoDue}
                onChange={(e) => setLinkedTodoDue(e.target.value)}
                className="w-40"
              />
              <Select
                value={linkedTodoPriority}
                onValueChange={(v) => setLinkedTodoPriority(v as ItemPriority | "none")}
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
            <TagInput
              tags={linkedTodoTags}
              allTags={allTags}
              onAdd={(tag) => setLinkedTodoTags((prev) => [...prev, tag])}
              onRemove={(tag) => setLinkedTodoTags((prev) => prev.filter((t) => t !== tag))}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCreateTodo(false)}
              >
                取消
              </Button>
              <Button
                size="sm"
                onClick={handleCreateLinkedTodo}
                disabled={!linkedTodoTitle.trim() || creatingTodo}
              >
                {creatingTodo ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : null}
                建立
              </Button>
            </div>
          </div>
        )}

        {/* Linked todos section (note only) */}
        {item.type === "note" && (linkedTodos.length > 0 || linkedTodosLoading) && (
          <div>
            <label className="text-sm text-muted-foreground block mb-2">
              關聯待辦
            </label>
            {linkedTodosLoading ? (
              <p className="text-xs text-muted-foreground">載入中...</p>
            ) : (
              <div className="space-y-1">
                {linkedTodos.map((todo) => (
                  <button
                    key={todo.id}
                    type="button"
                    className="w-full text-left p-2 rounded-md border hover:bg-accent transition-colors flex items-center gap-2"
                    onClick={() => onNavigate?.(todo.id)}
                  >
                    <ListTodo className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className={`text-sm truncate flex-1 ${todo.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                      {todo.title}
                    </span>
                    <Badge
                      variant="outline"
                      className={`text-xs shrink-0 ${
                        todo.status === "done"
                          ? "text-muted-foreground"
                          : todo.status === "active"
                            ? "text-sky-600 dark:text-sky-400"
                            : ""
                      }`}
                    >
                      {todo.status === "active" ? "進行中" : todo.status === "done" ? "已完成" : "已封存"}
                    </Badge>
                    {todo.due && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {todo.due}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Metadata */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>建立: {new Date(item.created).toLocaleString("zh-TW")}</p>
          <p>更新: {new Date(item.modified).toLocaleString("zh-TW")}</p>
        </div>
      </div>
    </div>
  );
}
