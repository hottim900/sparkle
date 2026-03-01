import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createShare, getItemShares, revokeShare } from "@/lib/api";
import type { ShareToken } from "@/lib/types";
import { toast } from "sonner";
import { Copy, Loader2, Plus, Trash2, Link, Globe, EyeOff } from "lucide-react";

interface ShareDialogProps {
  itemId: string;
  itemTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isOnline?: boolean;
}

export function ShareDialog({
  itemId,
  itemTitle,
  open,
  onOpenChange,
  isOnline = true,
}: ShareDialogProps) {
  const [shares, setShares] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<"unlisted" | "public">("unlisted");

  const loadShares = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getItemShares(itemId);
      setShares(res.shares);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    if (open) {
      loadShares();
    }
  }, [open, loadShares]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createShare(itemId, visibility);
      setShares((prev) => [...prev, res.share]);
      const fullUrl = `${window.location.origin}${res.url}`;
      await navigator.clipboard.writeText(fullUrl);
      toast.success("已建立分享並複製連結");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "建立分享失敗");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (token: string) => {
    const url = `${window.location.origin}/s/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("已複製連結");
    } catch {
      toast.error("複製失敗");
    }
  };

  const handleRevoke = async (shareId: string) => {
    setRevokingId(shareId);
    try {
      await revokeShare(shareId);
      setShares((prev) => prev.filter((s) => s.id !== shareId));
      toast.success("已撤銷分享");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "撤銷失敗");
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享筆記</DialogTitle>
          <DialogDescription className="truncate">{itemTitle}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Existing shares */}
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : shares.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">目前分享</p>
              {shares.map((share) => (
                <div key={share.id} className="flex items-center gap-2 rounded-md border p-2">
                  {share.visibility === "public" ? (
                    <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-xs">
                        {share.visibility === "public" ? "公開" : "僅限連結"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(share.created).toLocaleDateString("zh-TW")}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      /s/{share.token}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleCopy(share.token)}
                    title="複製連結"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive"
                    onClick={() => handleRevoke(share.id)}
                    disabled={revokingId === share.id || !isOnline}
                    title="撤銷分享"
                  >
                    {revokingId === share.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Create new share */}
          <div className="space-y-2">
            {shares.length > 0 && <p className="text-sm text-muted-foreground">新增分享</p>}
            <div className="flex items-center gap-2">
              <Select
                value={visibility}
                onValueChange={(v) => setVisibility(v as "unlisted" | "public")}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unlisted">
                    <span className="flex items-center gap-1.5">
                      <EyeOff className="h-3.5 w-3.5" />
                      僅限連結
                    </span>
                  </SelectItem>
                  <SelectItem value="public">
                    <span className="flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5" />
                      公開
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleCreate} disabled={creating || !isOnline} className="gap-1.5">
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                建立分享
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {visibility === "unlisted" ? "僅知道連結的人可以查看" : "會出現在公開列表中"}
            </p>
          </div>

          {/* Share link preview */}
          {shares.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground border-t pt-3">
              <Link className="h-3 w-3" />
              <span>分享頁面會顯示筆記標題、內容、標籤和時間戳記</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
