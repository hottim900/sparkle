import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateItem, getItem, createItem, getLinkedTodos, searchItemsApi } from "@/lib/api";
import { parseItem, parseItems, type ParsedItem, type ItemPriority, type Item } from "@/lib/types";
import { TagInput } from "@/components/tag-input";
import { toast } from "sonner";
import { Loader2, X, ListTodo, FileText, Plus, Search, Unlink } from "lucide-react";

interface LinkedItemsSectionProps {
  item: ParsedItem;
  allTags: string[];
  createTodoRequested: boolean;
  onCreateTodoDismiss: () => void;
  onNavigate?: (itemId: string) => void;
  onUpdated?: () => void;
  onItemChange: (item: ParsedItem) => void;
  onSaveStatusChange: (status: "idle" | "saving" | "saved") => void;
}

export function LinkedItemsSection({
  item,
  allTags,
  createTodoRequested,
  onCreateTodoDismiss,
  onNavigate,
  onUpdated,
  onItemChange,
  onSaveStatusChange,
}: LinkedItemsSectionProps) {
  // Linked todo state (for notes)
  const [showCreateTodo, setShowCreateTodo] = useState(false);
  const [linkedTodoTitle, setLinkedTodoTitle] = useState("");
  const [linkedTodoDue, setLinkedTodoDue] = useState("");
  const [linkedTodoPriority, setLinkedTodoPriority] = useState<ItemPriority | "none">("none");
  const [linkedTodoTags, setLinkedTodoTags] = useState<string[]>([]);
  const [creatingTodo, setCreatingTodo] = useState(false);
  const [linkedTodos, setLinkedTodos] = useState<ParsedItem[]>([]);
  const [linkedTodosLoading, setLinkedTodosLoading] = useState(false);

  // Linked note state (for todos)
  const [linkedNoteTitle, setLinkedNoteTitle] = useState<string | null>(null);
  const [showNoteSearch, setShowNoteSearch] = useState(false);
  const [noteSearchQuery, setNoteSearchQuery] = useState("");
  const [noteSearchResults, setNoteSearchResults] = useState<Item[]>([]);
  const [noteSearching, setNoteSearching] = useState(false);
  const noteSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Reset state when item changes
  useEffect(() => {
    setShowCreateTodo(false);
    setLinkedNoteTitle(null);
    setShowNoteSearch(false);
    setNoteSearchQuery("");
    setNoteSearchResults([]);
  }, [item.id]);

  // Handle create todo request from header button
  useEffect(() => {
    if (createTodoRequested && item.type === "note") {
      setLinkedTodoTitle(`處理：${item.title}`);
      setLinkedTodoDue("");
      setLinkedTodoPriority("none");
      setLinkedTodoTags([...item.tags]);
      setShowCreateTodo(true);
      onCreateTodoDismiss();
    }
  }, [createTodoRequested, item.type, item.title, item.tags, onCreateTodoDismiss]);

  // Fetch linked todos for notes
  const loadLinkedTodos = useCallback(async () => {
    if (item.type !== "note") return;
    setLinkedTodosLoading(true);
    try {
      const res = await getLinkedTodos(item.id);
      setLinkedTodos(parseItems(res.items));
    } catch {
      // silently fail
    } finally {
      setLinkedTodosLoading(false);
    }
  }, [item.id, item.type]);

  useEffect(() => {
    if (item.type === "note") {
      loadLinkedTodos();
    }
  }, [item.id, item.type, loadLinkedTodos]);

  // Fetch linked note title for backlink display on todos
  useEffect(() => {
    if (item.type === "todo" && item.linked_note_id) {
      getItem(item.linked_note_id)
        .then((noteData) => setLinkedNoteTitle(noteData.title))
        .catch(() => setLinkedNoteTitle(null));
    }
  }, [item.type, item.linked_note_id]);

  // Cleanup timeouts
  useEffect(() => {
    return () => {
      if (noteSearchTimeoutRef.current) clearTimeout(noteSearchTimeoutRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const handleCreateLinkedTodo = async () => {
    if (creatingTodo) return;
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

  const handleNoteSearch = useCallback((query: string) => {
    setNoteSearchQuery(query);
    if (noteSearchTimeoutRef.current) clearTimeout(noteSearchTimeoutRef.current);
    if (!query.trim()) {
      setNoteSearchResults([]);
      return;
    }
    noteSearchTimeoutRef.current = setTimeout(async () => {
      setNoteSearching(true);
      try {
        const res = await searchItemsApi(query, 10);
        setNoteSearchResults(res.results.filter((r) => r.type === "note"));
      } catch {
        setNoteSearchResults([]);
      } finally {
        setNoteSearching(false);
      }
    }, 300);
  }, []);

  const handleLinkNote = async (noteId: string) => {
    onSaveStatusChange("saving");
    try {
      const updated = await updateItem(item.id, { linked_note_id: noteId });
      onItemChange(parseItem(updated));
      setShowNoteSearch(false);
      setNoteSearchQuery("");
      setNoteSearchResults([]);
      const noteData = await getItem(noteId);
      setLinkedNoteTitle(noteData.title);
      onUpdated?.();
      onSaveStatusChange("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => onSaveStatusChange("idle"), 2000);
    } catch (err) {
      onSaveStatusChange("idle");
      toast.error(err instanceof Error ? err.message : "關聯失敗");
    }
  };

  const handleUnlinkNote = async () => {
    onSaveStatusChange("saving");
    try {
      const updated = await updateItem(item.id, { linked_note_id: null });
      onItemChange(parseItem(updated));
      setLinkedNoteTitle(null);
      onUpdated?.();
      onSaveStatusChange("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => onSaveStatusChange("idle"), 2000);
    } catch (err) {
      onSaveStatusChange("idle");
      toast.error(err instanceof Error ? err.message : "解除關聯失敗");
    }
  };

  return (
    <>
      {/* Linked note section (todo only) */}
      {item.type === "todo" && (
        <div>
          <label className="text-sm text-muted-foreground block mb-1">關聯筆記</label>
          {item.linked_note_id && linkedNoteTitle ? (
            <div className="space-y-1">
              <button
                type="button"
                className="w-full text-left p-2 rounded-md border hover:bg-accent transition-colors flex items-center gap-2"
                onClick={() => onNavigate?.(item.linked_note_id!)}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="text-sm truncate flex-1">{linkedNoteTitle}</span>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-destructive"
                onClick={handleUnlinkNote}
              >
                <Unlink className="h-3 w-3" />
                解除關聯
              </Button>
            </div>
          ) : (
            <>
              {showNoteSearch ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={noteSearchQuery}
                        onChange={(e) => handleNoteSearch(e.target.value)}
                        placeholder="搜尋筆記..."
                        className="pl-8 h-8 text-sm"
                        autoFocus
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setShowNoteSearch(false);
                        setNoteSearchQuery("");
                        setNoteSearchResults([]);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {noteSearching && <p className="text-xs text-muted-foreground">搜尋中...</p>}
                  {noteSearchResults.length > 0 && (
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {noteSearchResults.map((note) => (
                        <button
                          key={note.id}
                          type="button"
                          className="w-full text-left p-2 rounded-md border hover:bg-accent transition-colors flex items-center gap-2"
                          onClick={() => handleLinkNote(note.id)}
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="text-sm truncate">{note.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {!noteSearching && noteSearchQuery.trim() && noteSearchResults.length === 0 && (
                    <p className="text-xs text-muted-foreground">找不到筆記</p>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => setShowNoteSearch(true)}
                >
                  <Search className="h-3 w-3" />
                  搜尋並關聯筆記
                </Button>
              )}
            </>
          )}
        </div>
      )}

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
            <Button variant="outline" size="sm" onClick={() => setShowCreateTodo(false)}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleCreateLinkedTodo}
              disabled={!linkedTodoTitle.trim() || creatingTodo}
            >
              {creatingTodo ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              建立
            </Button>
          </div>
        </div>
      )}

      {/* Linked todos section (note only) */}
      {item.type === "note" && (linkedTodos.length > 0 || linkedTodosLoading) && (
        <div>
          <label className="text-sm text-muted-foreground block mb-2">關聯待辦</label>
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
                  <span
                    className={`text-sm truncate flex-1 ${todo.status === "done" ? "line-through text-muted-foreground" : ""}`}
                  >
                    {todo.title}
                  </span>
                  {todo.due && (
                    <span className="text-xs text-muted-foreground shrink-0">{todo.due}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
