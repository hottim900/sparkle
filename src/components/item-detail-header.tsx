import { useState } from "react";
import { toast } from "sonner";
import { useVaultPathBySparkleId } from "@/hooks/use-vault-path-by-sparkle-id";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ParsedItem } from "@/lib/types";
import {
  Trash2,
  ArrowLeft,
  Loader2,
  Check,
  ExternalLink,
  X,
  ListTodo,
  FileText,
  StickyNote,
  Share2,
  Link,
  Globe,
  Lock,
  FolderOpen,
} from "lucide-react";

interface ItemDetailHeaderProps {
  item: ParsedItem;
  obsidianEnabled?: boolean;
  canGoBack?: boolean;
  saveStatus: "idle" | "saving" | "saved";
  exporting: boolean;
  releasing?: boolean;
  isOnline?: boolean;
  onBack?: () => void;
  onClose?: () => void;
  onExport: () => void;
  onDelete: () => void;
  onRelease?: () => void;
  onOpenCreateTodo: () => void;
  onOpenShare: () => void;
  onMarkAsPrivate: () => void;
  markingAsPrivate?: boolean;
}

export function ItemDetailHeader({
  item,
  obsidianEnabled,
  canGoBack,
  saveStatus,
  exporting,
  releasing = false,
  onBack,
  onClose,
  onExport,
  onDelete,
  onRelease,
  onOpenCreateTodo,
  isOnline = true,
  onOpenShare,
  onMarkAsPrivate,
  markingAsPrivate = false,
}: ItemDetailHeaderProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const showExportButton = obsidianEnabled && item.type === "note" && item.status === "permanent";
  const isExported = item.origin === "vault";

  // Live reverse-lookup; null = file no longer indexed; undefined while loading.
  // PR 2 dual-write window: fall back to items_vault.export_path snapshot. PR 3
  // drops the `?? item.export_path` tail when fallback usage hits zero.
  const vaultPathQuery = useVaultPathBySparkleId(isExported ? item.id : undefined);
  const liveVaultPath = vaultPathQuery.data?.path ?? null;
  const fallbackVaultPath = item.export_path;
  const resolvedVaultPath = liveVaultPath ?? fallbackVaultPath;
  const vaultPathLoading = vaultPathQuery.isLoading && !fallbackVaultPath;
  const vaultPathDeleted =
    !vaultPathQuery.isLoading && vaultPathQuery.data === null && !fallbackVaultPath;

  const handleCopyPath = () => {
    if (!resolvedVaultPath) return;
    navigator.clipboard.writeText(resolvedVaultPath);
    toast.success("已複製 vault 路徑");
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onBack ?? onClose}
                aria-label={canGoBack ? "返回上一頁" : "關閉"}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{canGoBack ? "返回上一頁" : "關閉"}</TooltipContent>
          </Tooltip>
          {canGoBack && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onClose} aria-label="關閉詳情">
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>關閉詳情</TooltipContent>
            </Tooltip>
          )}
        </div>
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
          {isExported ? null : (
            <>
              {item.type === "note" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={onOpenCreateTodo}
                  disabled={!isOnline}
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
                  onClick={onExport}
                  disabled={exporting || !isOnline}
                >
                  {exporting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ExternalLink className="h-3 w-3" />
                  )}
                  匯出到 Obsidian
                </Button>
              )}
              {item.type === "note" && (
                <Button
                  variant="outline"
                  size="sm"
                  className={`gap-1 text-xs ${item.share_visibility === "public" ? "text-blue-600 dark:text-blue-400" : ""}`}
                  onClick={onOpenShare}
                  disabled={!isOnline}
                >
                  {item.share_visibility === "public" ? (
                    <Globe className="h-3 w-3" />
                  ) : item.share_visibility === "unlisted" ? (
                    <Link className="h-3 w-3" />
                  ) : (
                    <Share2 className="h-3 w-3" />
                  )}
                  {item.share_visibility === "public"
                    ? "已公開分享"
                    : item.share_visibility === "unlisted"
                      ? "已分享"
                      : "分享"}
                </Button>
              )}
              {item.type !== "scratch" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1 text-xs"
                      onClick={onMarkAsPrivate}
                      disabled={markingAsPrivate || !isOnline}
                      aria-label="標記為私密"
                    >
                      {markingAsPrivate ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Lock className="h-3 w-3" />
                      )}
                      標記為私密
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>標記為私密</TooltipContent>
                </Tooltip>
              )}
            </>
          )}
          {isExported ? (
            <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1 text-xs"
                      disabled={!isOnline || releasing || !onRelease}
                      aria-label="釋出"
                    >
                      {releasing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                      釋出
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>釋出 Sparkle 記錄；vault 檔案保留</TooltipContent>
              </Tooltip>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>釋出 Sparkle 記錄</DialogTitle>
                  <DialogDescription>
                    Sparkle 將不再記錄這筆筆記。vault 檔案
                    {resolvedVaultPath ? ` ${resolvedVaultPath} ` : " "}
                    保留不變動。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setReleaseOpen(false)}>
                    取消
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      onRelease?.();
                      setReleaseOpen(false);
                    }}
                  >
                    釋出
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" disabled={!isOnline} aria-label="刪除">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>刪除</TooltipContent>
              </Tooltip>
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
                  <Button
                    variant="destructive"
                    onClick={() => {
                      onDelete();
                      setDeleteOpen(false);
                    }}
                  >
                    刪除
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Type indicator bar */}
      <div
        className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium ${
          item.type === "note"
            ? "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
            : item.type === "todo"
              ? "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        }`}
      >
        {item.type === "note" ? (
          <FileText className="h-3.5 w-3.5" />
        ) : item.type === "todo" ? (
          <ListTodo className="h-3.5 w-3.5" />
        ) : (
          <StickyNote className="h-3.5 w-3.5" />
        )}
        {item.type === "note" ? "筆記" : item.type === "todo" ? "待辦" : "暫存"}
      </div>

      {/* Vault-origin indicator bar (third bar, slate; amber is owned by paused) */}
      {isExported && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleCopyPath}
              disabled={!resolvedVaultPath}
              className="flex w-full items-center gap-1.5 bg-slate-50 px-4 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:disabled:hover:bg-slate-800"
              aria-label={
                vaultPathLoading
                  ? "vault 路徑解析中"
                  : vaultPathDeleted
                    ? "此檔案已從 Vault 刪除"
                    : `位於 vault · ${resolvedVaultPath}，點擊複製`
              }
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {vaultPathLoading ? (
                  <>
                    位於 vault
                    <Loader2 className="ml-1 inline h-3 w-3 animate-spin" /> 索引更新中…
                  </>
                ) : vaultPathDeleted ? (
                  "此檔案已從 Vault 刪除"
                ) : (
                  <>位於 vault{resolvedVaultPath ? ` · ${resolvedVaultPath}` : ""}</>
                )}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {vaultPathLoading
              ? "索引更新中…"
              : vaultPathDeleted
                ? "此檔案已從 Vault 刪除"
                : "點擊複製 vault 路徑"}
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
}
