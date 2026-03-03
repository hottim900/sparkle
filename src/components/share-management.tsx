import { useEffect, useState } from "react";
import { toast } from "sonner";
import { listShares, revokeShare } from "@/lib/api";
import type { ShareToken } from "@/lib/types";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Share2, Copy, Trash2, Globe, EyeOff, Loader2 } from "lucide-react";

interface ShareManagementProps {
  onNavigateToItem: (itemId: string) => void;
}

export function ShareManagement({ onNavigateToItem }: ShareManagementProps) {
  const [shares, setShares] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    let cancelled = false;

    listShares()
      .then((data) => {
        if (!cancelled) setShares(data.shares);
      })
      .catch(() => {
        if (!cancelled) toast.error("無法載入分享資料");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCopyShareLink(token: string) {
    const url = `${window.location.origin}/s/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("已複製連結");
    } catch {
      toast.error("複製失敗");
    }
  }

  async function handleRevokeShare(shareId: string) {
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
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-4">
      <div className="max-w-2xl mx-auto p-4 space-y-6">
        {/* Page title */}
        <div className="flex items-center gap-2">
          <Share2 className="h-5 w-5" />
          <h1 className="text-xl font-bold">分享管理</h1>
          {shares.length > 0 && <Badge variant="secondary">{shares.length} 個分享</Badge>}
        </div>

        {/* Content */}
        <div className="border rounded-lg p-4">
          {shares.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Share2 className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">尚無分享的筆記</p>
              <p className="text-xs text-muted-foreground">
                在筆記詳情中點擊分享按鈕來建立分享連結。
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {shares.map((share) => (
                <div key={share.id} className="flex items-center gap-2 rounded-md border p-2">
                  {share.visibility === "public" ? (
                    <Globe className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex-1 min-w-0">
                    <button
                      className="text-sm text-primary hover:underline truncate block max-w-full text-left"
                      onClick={() => onNavigateToItem(share.item_id)}
                    >
                      {share.item_title ?? "未知筆記"}
                    </button>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Badge variant="secondary" className="text-xs">
                        {share.visibility === "public" ? "公開" : "僅限連結"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {new Date(share.created).toLocaleDateString("zh-TW")}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleCopyShareLink(share.token)}
                    title="複製連結"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive"
                    onClick={() => handleRevokeShare(share.id)}
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
          )}
        </div>
      </div>
    </div>
  );
}
