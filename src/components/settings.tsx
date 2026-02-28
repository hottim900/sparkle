import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  getSettings,
  updateSettings,
  exportData,
  importData,
  listShares,
  revokeShare,
} from "@/lib/api";
import type { SettingsResponse, ShareToken } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings as SettingsIcon,
  Loader2,
  Save,
  Sun,
  Moon,
  Download,
  Upload,
  ExternalLink,
  Share2,
  Copy,
  Trash2,
  Globe,
  EyeOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SettingsProps {
  onSettingsChanged: () => void;
}

export function Settings({ onSettingsChanged }: SettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);

  // Local form state
  const [enabled, setEnabled] = useState(false);
  const [vaultPath, setVaultPath] = useState("");
  const [inboxFolder, setInboxFolder] = useState("0_Inbox");
  const [exportMode, setExportMode] = useState("overwrite");

  // Share management state
  const [shares, setShares] = useState<ShareToken[]>([]);
  const [sharesLoading, setSharesLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const { resolvedTheme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [settingsData, sharesData] = await Promise.all([getSettings(), listShares()]);
        if (cancelled) return;
        setSettings(settingsData);
        setEnabled(settingsData.obsidian_enabled === "true");
        setVaultPath(settingsData.obsidian_vault_path);
        setInboxFolder(settingsData.obsidian_inbox_folder);
        setExportMode(settingsData.obsidian_export_mode);
        setShares(sharesData.shares);
      } catch {
        if (!cancelled) {
          toast.error("無法載入設定");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSharesLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const data = await updateSettings({
        obsidian_enabled: enabled ? "true" : "false",
        obsidian_vault_path: vaultPath,
        obsidian_inbox_folder: inboxFolder,
        obsidian_export_mode: exportMode,
      });
      setSettings(data);
      toast.success("設定已儲存");
      onSettingsChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "儲存設定失敗");
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    try {
      const data = await exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `sparkle-backup-${date}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已匯出 ${data.items.length} 筆資料`);
    } catch {
      toast.error("匯出失敗");
    }
  }

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

  async function handleImport(file: File) {
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const items = json.items ?? json;
      if (!Array.isArray(items)) {
        toast.error("無效的匯入檔案格式");
        return;
      }
      const result = await importData({ items });
      toast.success(`已匯入 ${result.imported} 筆，更新 ${result.updated} 筆`);
    } catch {
      toast.error("匯入失敗，請確認檔案格式正確");
    }
  }

  const hasChanges =
    settings !== null &&
    (enabled !== (settings.obsidian_enabled === "true") ||
      vaultPath !== settings.obsidian_vault_path ||
      inboxFolder !== settings.obsidian_inbox_folder ||
      exportMode !== settings.obsidian_export_mode);

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
          <SettingsIcon className="h-5 w-5" />
          <h1 className="text-xl font-bold">設定</h1>
        </div>

        {/* Section 1: Obsidian Export */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">Obsidian 匯出</h2>
          </div>

          <div className="border rounded-lg p-4 space-y-4">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">啟用 Obsidian 匯出</p>
                <p className="text-xs text-muted-foreground">允許將永久筆記匯出到 Obsidian vault</p>
              </div>
              <Button
                variant={enabled ? "default" : "outline"}
                size="sm"
                onClick={() => setEnabled(!enabled)}
              >
                {enabled ? "已啟用" : "已停用"}
              </Button>
            </div>

            {/* Vault path */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Vault 路徑</label>
              <Input
                value={vaultPath}
                onChange={(e) => setVaultPath(e.target.value)}
                placeholder="/home/user/obsidian-vault"
                disabled={!enabled}
              />
              <p className="text-xs text-muted-foreground mt-1">伺服器端檔案路徑</p>
            </div>

            {/* Inbox folder */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">收件匣資料夾</label>
              <Input
                value={inboxFolder}
                onChange={(e) => setInboxFolder(e.target.value)}
                placeholder="0_Inbox"
                disabled={!enabled}
              />
            </div>

            {/* Export mode */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">匯出模式</label>
              <Select value={exportMode} onValueChange={setExportMode} disabled={!enabled}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overwrite">覆蓋既有</SelectItem>
                  <SelectItem value="new">建立新檔</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Save button */}
            <div className="flex justify-end">
              <Button onClick={handleSave} disabled={saving || !hasChanges} className="gap-1.5">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                儲存設定
              </Button>
            </div>
          </div>
        </section>

        {/* Section 2: Share Management */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">分享管理</h2>
          </div>

          <div className="border rounded-lg p-4">
            {sharesLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : shares.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">尚無分享的筆記</p>
            ) : (
              <div className="space-y-2">
                {shares.map((share) => (
                  <div key={share.id} className="flex items-center gap-2 rounded-md border p-2">
                    {share.visibility === "public" ? (
                      <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{share.item_title ?? "未知筆記"}</p>
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
                      disabled={revokingId === share.id}
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
        </section>

        {/* Section 3: General */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">一般</h2>
          </div>

          <div className="border rounded-lg p-4 space-y-2">
            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-muted-foreground"
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            >
              {resolvedTheme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
              {resolvedTheme === "dark" ? "淺色模式" : "深色模式"}
            </Button>

            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-muted-foreground"
              onClick={handleExport}
            >
              <Download className="h-4 w-4" />
              匯出資料
            </Button>

            <Button
              variant="ghost"
              className="w-full justify-start gap-2 text-muted-foreground"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              匯入資料
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleImport(file);
                  e.target.value = "";
                }
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
