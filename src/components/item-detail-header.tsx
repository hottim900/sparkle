import { useState } from "react";
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
} from "lucide-react";

interface ItemDetailHeaderProps {
  item: ParsedItem;
  obsidianEnabled?: boolean;
  canGoBack?: boolean;
  saveStatus: "idle" | "saving" | "saved";
  exporting: boolean;
  isOnline?: boolean;
  onBack?: () => void;
  onClose?: () => void;
  onExport: () => void;
  onDelete: () => void;
  onOpenCreateTodo: () => void;
  onOpenShare: () => void;
}

export function ItemDetailHeader({
  item,
  obsidianEnabled,
  canGoBack,
  saveStatus,
  exporting,
  onBack,
  onClose,
  onExport,
  onDelete,
  onOpenCreateTodo,
  isOnline = true,
  onOpenShare,
}: ItemDetailHeaderProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const showExportButton = obsidianEnabled && item.type === "note" && item.status === "permanent";

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack ?? onClose}
            title={canGoBack ? "返回上一頁" : "關閉"}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {canGoBack && (
            <Button variant="ghost" size="icon" onClick={onClose} title="關閉詳情">
              <X className="h-4 w-4" />
            </Button>
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
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" disabled={!isOnline}>
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
    </>
  );
}
