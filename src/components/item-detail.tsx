import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, type NavigateOptions } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { type ParsedItem, type ItemStatus } from "@/lib/types";
import { useItemActions } from "@/hooks/use-item-actions";
import { TagInput } from "@/components/tag-input";
import { useAppContext } from "@/lib/app-context";
import { toast } from "sonner";
import { X, ExternalLink } from "lucide-react";
import { ShareDialog } from "@/components/share-dialog";
import { ItemDetailHeader } from "@/components/item-detail-header";
import { LinkedItemsSection } from "@/components/linked-items-section";
import { ItemContentEditor } from "@/components/item-content-editor";
import { CategorySelect } from "@/components/category-select";
import { PauseToggle } from "@/components/pause-toggle";
import { PausedBanner } from "@/components/paused-banner";
import { useItemForm } from "@/hooks/use-item-form";
import { usePauseResume } from "@/hooks/use-pause-resume";
import { updateItem, getSettings } from "@/lib/api";
import {
  useResolvedVaultPath,
  useVaultPathBySparkleId,
} from "@/hooks/use-vault-path-by-sparkle-id";
import { useAnnouncement } from "@/components/announcement-provider";
import { queryKeys } from "@/lib/query-keys";

interface ItemDetailProps {
  itemId: string;
  onDeleted?: () => void;
  onBack?: () => void;
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

const scratchStatuses: { value: ItemStatus; label: string }[] = [
  { value: "draft", label: "暫存" },
  { value: "archived", label: "已封存" },
];

const gtdTags = [
  { tag: "next-action", label: "下一步" },
  { tag: "waiting-on", label: "等待中" },
  { tag: "someday", label: "有一天" },
];

export function ItemDetail({ itemId, onDeleted, onBack, onNavigate }: ItemDetailProps) {
  const {
    item,
    setItem,
    isLoading,
    setIsDirty,
    saveStatus,
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
  const queryClient = useQueryClient();
  const { obsidianEnabled, isOnline } = useAppContext();
  const { handleDelete, handleExport, handleRelease, exporting, releasing } = useItemActions(item, {
    isOnline,
    obsidianEnabled,
    invalidateAfterSave,
    onDeleted,
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [aliasInput, setAliasInput] = useState("");
  const [createTodoRequested, setCreateTodoRequested] = useState(false);

  // Reverse-lookup query (raw) — kept alongside the derived `resolvedVaultPath`
  // because the announce-on-change effect needs the live `data?.path` separate
  // from the snapshot fallback.
  const vaultPathQuery = useVaultPathBySparkleId(item?.origin === "vault" ? item.id : undefined);
  const { resolvedVaultPath } = useResolvedVaultPath(item);

  const { data: settings } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: getSettings,
    enabled: !!item && item.origin === "vault",
    retry: false,
  });
  const vaultName = settings?.obsidian_vault_path
    ? settings.obsidian_vault_path.replace(/\/+$/, "").split("/").pop() || ""
    : "";

  const obsidianUri =
    vaultName && resolvedVaultPath
      ? `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(resolvedVaultPath.replace(/\.md$/, ""))}`
      : null;

  // Announce when reverse-lookup surfaces a path that differs from the cached
  // export_path snapshot — silent jumps would otherwise be invisible to AT.
  const announce = useAnnouncement();
  const lastAnnouncedRef = useRef<string | null>(null);
  useEffect(() => {
    const fresh = vaultPathQuery.data?.path ?? null;
    const fallback = item?.export_path ?? null;
    if (fresh && fallback && fresh !== fallback && lastAnnouncedRef.current !== fresh) {
      lastAnnouncedRef.current = fresh;
      announce("vault 路徑已更新");
    }
  }, [vaultPathQuery.data?.path, item?.export_path, announce]);

  const [markingAsPrivate, setMarkingAsPrivate] = useState(false);
  const { handleResume, resuming } = usePauseResume(item, setItem);

  const handleMarkAsPrivate = useCallback(async () => {
    if (!item) return;
    setMarkingAsPrivate(true);
    try {
      await updateItem(item.id, { is_private: true });
      queryClient.invalidateQueries({ queryKey: queryKeys.items.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.tags });
      queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      toast.success("已標記為私密");
      navigate({
        search: (prev) => ({ ...prev, item: undefined }),
      } as NavigateOptions);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "標記失敗");
    } finally {
      setMarkingAsPrivate(false);
    }
  }, [item, queryClient, navigate]);

  const handleBack = useCallback(() => {
    if (onBack) {
      onBack();
    } else {
      navigate({
        search: (prev) => ({ ...prev, item: undefined }),
      } as NavigateOptions);
    }
  }, [navigate, onBack]);

  const handleNavigate = useCallback(
    (linkedItemId: string) => {
      if (onNavigate) {
        onNavigate(linkedItemId);
      } else {
        navigate({
          search: (prev) => ({ ...prev, item: linkedItemId }),
        } as NavigateOptions);
      }
    },
    [navigate, onNavigate],
  );

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
        releasing={releasing}
        isOnline={isOnline}
        onBack={handleBack}
        onClose={handleBack}
        onExport={handleExport}
        onDelete={handleDelete}
        onRelease={handleRelease}
        onOpenCreateTodo={() => setCreateTodoRequested(true)}
        onOpenShare={() => setShareOpen(true)}
        onMarkAsPrivate={handleMarkAsPrivate}
        markingAsPrivate={markingAsPrivate}
      />

      {item.origin === "vault" ? (
        /* ── Exported: Read-only view ── */
        <div className="flex-1 overflow-y-auto p-4 space-y-4 animate-fade-in break-words">
          {/* Vault link (the header slate bar already shows "位於 vault · path") */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>已匯出至 Obsidian</span>
            {vaultPathQuery.isLoading && !item.export_path ? (
              <span aria-live="polite">索引更新中…</span>
            ) : resolvedVaultPath ? (
              <a
                href={`/vault?file=${encodeURIComponent(resolvedVaultPath)}`}
                className={`inline-flex items-center gap-1 ${isOnline ? "text-foreground hover:underline" : "pointer-events-none"}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (isOnline) {
                    navigate({
                      to: "/vault",
                      search: { file: resolvedVaultPath, filter: undefined },
                    });
                  }
                }}
              >
                <ExternalLink className="h-3 w-3" />在 Vault 中查看
              </a>
            ) : (
              <span>此檔案已從 Vault 刪除</span>
            )}
          </div>

          {/* Title (read-only) */}
          <h1 className="text-lg font-semibold px-0">{item.title}</h1>

          {/* ID + timestamps */}
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

          {/* Metadata (read-only) */}
          <div className="flex gap-2 flex-wrap text-sm text-muted-foreground">
            <span>筆記</span>
            {item.category_name && (
              <>
                <span>·</span>
                <span>{item.category_name}</span>
              </>
            )}
            {item.tags.length > 0 && (
              <>
                <span>·</span>
                <div className="flex gap-1 flex-wrap">
                  {item.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </>
            )}
            {item.priority && (
              <>
                <span>·</span>
                <span>
                  {item.priority === "high" ? "高" : item.priority === "medium" ? "中" : "低"}優先
                </span>
              </>
            )}
          </div>

          {/* Source URL (read-only) */}
          {item.source && (
            <div>
              <label className="text-sm text-muted-foreground block mb-1">參考連結</label>
              <a
                href={item.source}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline break-all"
              >
                {item.source}
              </a>
            </div>
          )}

          {/* Content snippet — immutable 500-char preview (vault .md is authoritative). */}
          <div>
            <label className="text-sm text-muted-foreground block mb-1">內容預覽</label>
            <pre className="whitespace-pre-wrap break-words max-h-32 overflow-hidden text-xs text-muted-foreground relative bg-muted/30 rounded-md p-3">
              {item.content_snippet ?? item.content ?? ""}
              <span
                aria-hidden="true"
                className="pointer-events-none bg-gradient-to-b from-transparent to-slate-50 dark:to-slate-800 h-8 absolute bottom-0 inset-x-0"
              />
            </pre>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-muted-foreground">
              <span>節錄前 500 字；完整內容請至 vault 查看</span>
              {obsidianUri ? (
                <>
                  <a
                    href={obsidianUri}
                    className="inline-flex items-center gap-1 text-foreground hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />在 Obsidian 中開啟
                  </a>
                  {resolvedVaultPath ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-foreground hover:underline"
                      onClick={() => {
                        navigator.clipboard.writeText(resolvedVaultPath);
                        toast.success("已複製 vault 路徑");
                      }}
                    >
                      複製路徑
                    </button>
                  ) : null}
                  {/* Mobile microcopy — obsidian:// requires the app installed; copy-path is the always-works fallback. */}
                  <span className="text-muted-foreground/70">
                    若連結失效，複製路徑後在 Obsidian 開啟
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        /* ── Normal: Editable view ── */
        <>
          {/* Paused banner */}
          <PausedBanner
            item={item}
            isOnline={isOnline}
            onResume={handleResume}
            resuming={resuming}
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

              {item.type !== "scratch" && (
                <PauseToggle item={item} isOnline={isOnline} onItemUpdate={setItem} />
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
              createTodoRequested={createTodoRequested}
              onCreateTodoDismiss={dismissCreateTodo}
              isOnline={isOnline}
              onNavigate={handleNavigate}
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
            {item.origin_source && (
              <div>
                <label className="text-sm text-muted-foreground block mb-1">捕捉來源</label>
                <p className="text-sm px-3 py-2 bg-muted rounded-md">{item.origin_source}</p>
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
                      if (addAlias(aliasInput)) setAliasInput("");
                    }
                  }}
                  placeholder="新增別名..."
                />
              </div>
            )}

            {/* Content / Markdown */}
            <ItemContentEditor
              key={itemId}
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
        </>
      )}
    </div>
  );
}
