import { useState, useCallback } from "react";
import { useNavigate, type NavigateOptions } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteItem, getItem, exportItem } from "@/lib/api";
import { parseItem, type ParsedItem, type ItemStatus } from "@/lib/types";
import { TagInput } from "@/components/tag-input";
import { useAppContext } from "@/lib/app-context";
import { toast } from "sonner";
import { X } from "lucide-react";
import { ShareDialog } from "@/components/share-dialog";
import { ItemDetailHeader } from "@/components/item-detail-header";
import { LinkedItemsSection } from "@/components/linked-items-section";
import { ItemContentEditor } from "@/components/item-content-editor";
import { CategorySelect } from "@/components/category-select";
import { useItemForm } from "@/hooks/use-item-form";

interface ItemDetailProps {
  itemId: string;
  onDeleted?: () => void;
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

const scratchStatuses: { value: ItemStatus; label: string }[] = [
  { value: "draft", label: "暫存" },
  { value: "archived", label: "已封存" },
];

const gtdTags = [
  { tag: "next-action", label: "下一步" },
  { tag: "waiting-on", label: "等待中" },
  { tag: "someday", label: "有一天" },
];

export function ItemDetail({ itemId, onDeleted }: ItemDetailProps) {
  const {
    item,
    setItem,
    isLoading,
    setIsDirty,
    saveStatus,
    setSaveStatus,
    allTags,
    saveField,
    debouncedSave,
    flushSave,
    addTag,
    removeTag,
    addAlias,
    removeAlias,
    invalidateAfterSave,
  } = useItemForm(itemId);

  const navigate = useNavigate();
  const { obsidianEnabled, isOnline } = useAppContext();
  const [shareOpen, setShareOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aliasInput, setAliasInput] = useState("");
  const [createTodoRequested, setCreateTodoRequested] = useState(false);

  const handleBack = useCallback(() => {
    navigate({
      search: (prev: Record<string, unknown>) => ({ ...prev, item: undefined }),
    } as NavigateOptions);
  }, [navigate]);

  const handleNavigate = useCallback(
    (linkedItemId: string) => {
      navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, item: linkedItemId }),
      } as NavigateOptions);
    },
    [navigate],
  );

  const handleDelete = async () => {
    if (!item) return;
    if (!isOnline) {
      toast.error("離線中，無法刪除");
      return;
    }
    try {
      await deleteItem(item.id);
      toast.success("已刪除");
      invalidateAfterSave();
      onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    }
  };

  const handleExport = async () => {
    if (!item) return;
    if (!isOnline) {
      toast.error("離線中，無法匯出");
      return;
    }
    setExporting(true);
    try {
      const result = await exportItem(item.id);
      toast.success(`已匯出到 Obsidian: ${result.path}`);
      const updated = await getItem(item.id);
      setItem(parseItem(updated));
      invalidateAfterSave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "匯出失敗");
    } finally {
      setExporting(false);
    }
  };

  const dismissCreateTodo = useCallback(() => setCreateTodoRequested(false), []);

  if (isLoading) {
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

  const statusOptions =
    item.type === "note" ? noteStatuses : item.type === "todo" ? todoStatuses : scratchStatuses;

  return (
    <div className="h-full flex flex-col min-w-0">
      <ItemDetailHeader
        item={item}
        obsidianEnabled={obsidianEnabled}
        canGoBack={false}
        saveStatus={saveStatus}
        exporting={exporting}
        isOnline={isOnline}
        onBack={handleBack}
        onClose={handleBack}
        onExport={handleExport}
        onDelete={handleDelete}
        onOpenCreateTodo={() => setCreateTodoRequested(true)}
        onOpenShare={() => setShareOpen(true)}
      />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 animate-fade-in break-words">
        {/* Title */}
        <Input
          value={item.title}
          onChange={(e) => {
            setIsDirty(true);
            setItem({ ...item, title: e.target.value });
            debouncedSave("title", e.target.value);
          }}
          onBlur={() => flushSave("title", item.title)}
          className="text-lg font-semibold border-0 px-0 focus-visible:ring-0"
          placeholder="標題"
        />

        {/* Metadata */}
        <div className="text-xs text-muted-foreground font-mono">
          <button
            type="button"
            className="hover:text-foreground transition-colors cursor-pointer"
            title="點擊複製完整 ID"
            onClick={() => {
              navigator.clipboard.writeText(item.id);
              toast.success("已複製 ID");
            }}
          >
            {item.id.split("-")[0]}
          </button>
          {" · "}建立 {new Date(item.created).toLocaleString("zh-TW")} · 更新{" "}
          {new Date(item.modified).toLocaleString("zh-TW")}
        </div>

        {/* Type + Status + Priority row */}
        <div className="flex gap-2 flex-wrap">
          <Select
            value={item.type}
            onValueChange={(v) => {
              if (v !== "note") setShareOpen(false);
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
              <SelectItem value="scratch">暫存</SelectItem>
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

          {item.type !== "scratch" && (
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
          )}
        </div>

        {/* 分類 (not for scratch) */}
        {item.type !== "scratch" && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">分類</label>
            <CategorySelect
              value={item.category_id ?? null}
              onChange={(categoryId) => {
                setItem((prev) => (prev ? { ...prev, category_id: categoryId } : prev));
                saveField("category_id", categoryId);
              }}
              disabled={saveStatus === "saving"}
            />
          </div>
        )}

        {/* Due date (todo only) */}
        {item.type === "todo" && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">到期日</label>
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

        {/* Linked items (note: linked todos; todo: linked note) */}
        <LinkedItemsSection
          item={item}
          allTags={allTags}
          createTodoRequested={createTodoRequested}
          onCreateTodoDismiss={dismissCreateTodo}
          isOnline={isOnline}
          onNavigate={handleNavigate}
          onItemChange={setItem}
          onSaveStatusChange={setSaveStatus}
        />

        {/* Source URL */}
        <div>
          <label className="text-sm text-muted-foreground block mb-1">參考連結</label>
          <Input
            type="url"
            value={item.source ?? ""}
            onChange={(e) => {
              const val = e.target.value || null;
              setIsDirty(true);
              setItem({ ...item, source: val });
              debouncedSave("source", val);
            }}
            onBlur={() => flushSave("source", item.source)}
            placeholder="https://..."
          />
        </div>

        {/* Origin (read-only) */}
        {item.origin && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">捕捉來源</label>
            <p className="text-sm px-3 py-2 bg-muted rounded-md">{item.origin}</p>
          </div>
        )}

        {/* Tags */}
        {item.type !== "scratch" && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">標籤</label>
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
            <TagInput tags={item.tags} allTags={allTags} onAdd={addTag} onRemove={removeTag} />
          </div>
        )}

        {/* Aliases */}
        {item.type !== "scratch" && (
          <div>
            <label className="text-sm text-muted-foreground block mb-1">別名</label>
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
                  setAliasInput("");
                }
              }}
              placeholder="新增別名..."
            />
          </div>
        )}

        {/* Content / Markdown */}
        <ItemContentEditor
          content={item.content}
          offlineWarning={!isOnline}
          onChange={(content) => {
            setIsDirty(true);
            setItem({ ...item, content });
            debouncedSave("content", content);
          }}
          onBlur={() => flushSave("content", item.content)}
        />
      </div>

      {/* Share Dialog */}
      {item.type === "note" && (
        <ShareDialog
          itemId={item.id}
          itemTitle={item.title}
          open={shareOpen}
          onOpenChange={setShareOpen}
          isOnline={isOnline}
        />
      )}
    </div>
  );
}
