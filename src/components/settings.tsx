import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  getSettings,
  updateSettings,
  exportData,
  importData,
  sendLineBrief,
  generateDailyNote,
} from "@/lib/api";
import type { SettingsResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { CategoryManagement } from "@/components/category-management";
import {
  Settings as SettingsIcon,
  Loader2,
  Save,
  Sun,
  Moon,
  Download,
  Upload,
  ExternalLink,
  MessageSquare,
  Send,
  Calendar,
  Play,
} from "lucide-react";

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
  const [exportMode, setExportMode] = useState<"new" | "overwrite">("overwrite");
  const [recentDays, setRecentDays] = useState("7");
  const [staleDays, setStaleDays] = useState("14");
  const [savingDashboard, setSavingDashboard] = useState(false);
  const [lineBriefEnabled, setLineBriefEnabled] = useState(false);
  const [lineBriefTime, setLineBriefTime] = useState("21:00");
  const [savingLineBrief, setSavingLineBrief] = useState(false);
  const [sendingBrief, setSendingBrief] = useState(false);
  const [dailyNoteEnabled, setDailyNoteEnabled] = useState(false);
  const [dailyFolder, setDailyFolder] = useState("Daily");
  const [dailyNoteTime, setDailyNoteTime] = useState("23:00");
  const [dailyNoteMode, setDailyNoteMode] = useState<"subfolder" | "append">("subfolder");
  const [savingDailyNote, setSavingDailyNote] = useState(false);
  const [generating, setGenerating] = useState(false);

  const { resolvedTheme, setTheme } = useTheme();
  const isOnline = useOnlineStatus();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const settingsData = await getSettings();
        if (cancelled) return;
        setSettings(settingsData);
        setEnabled(settingsData.obsidian_enabled === "true");
        setVaultPath(settingsData.obsidian_vault_path);
        setInboxFolder(settingsData.obsidian_inbox_folder);
        setExportMode(settingsData.obsidian_export_mode);
        setRecentDays(settingsData.recent_days ?? "7");
        setStaleDays(settingsData.stale_days ?? "14");
        setLineBriefEnabled(settingsData.line_brief_enabled === "true");
        setLineBriefTime(settingsData.line_brief_time ?? "21:00");
        setDailyNoteEnabled(settingsData.daily_note_enabled === "true");
        setDailyFolder(settingsData.obsidian_daily_folder ?? "Daily");
        setDailyNoteTime(settingsData.daily_note_time ?? "23:00");
        setDailyNoteMode(settingsData.daily_note_mode ?? "subfolder");
      } catch {
        if (!cancelled) {
          toast.error("無法載入設定");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveSection(
    setSavingFn: (v: boolean) => void,
    fields: Record<string, string>,
    successMessage: string,
  ) {
    setSavingFn(true);
    try {
      const data = await updateSettings(fields);
      setSettings(data);
      toast.success(successMessage);
      onSettingsChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "儲存設定失敗");
    } finally {
      setSavingFn(false);
    }
  }

  async function handleSave() {
    await saveSection(
      setSaving,
      {
        obsidian_enabled: enabled ? "true" : "false",
        obsidian_vault_path: vaultPath,
        obsidian_inbox_folder: inboxFolder,
        obsidian_export_mode: exportMode,
      },
      "設定已儲存",
    );
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

  async function handleSaveDashboard() {
    await saveSection(
      setSavingDashboard,
      {
        recent_days: recentDays,
        stale_days: staleDays,
      },
      "Dashboard 設定已儲存",
    );
  }

  async function handleSaveLineBrief() {
    await saveSection(
      setSavingLineBrief,
      {
        line_brief_enabled: lineBriefEnabled ? "true" : "false",
        line_brief_time: lineBriefTime,
      },
      "LINE 簡報設定已儲存",
    );
  }

  async function handleSaveDailyNote() {
    await saveSection(
      setSavingDailyNote,
      {
        daily_note_enabled: dailyNoteEnabled ? "true" : "false",
        obsidian_daily_folder: dailyFolder,
        daily_note_time: dailyNoteTime,
        daily_note_mode: dailyNoteMode,
      },
      "Daily Note 設定已儲存",
    );
  }

  async function handleGenerateDailyNote() {
    setGenerating(true);
    try {
      const result = await generateDailyNote();
      if (result.skipped) {
        toast(`Daily note 已跳過：${result.reason}`);
      } else {
        toast.success(`Daily note 已生成：${result.path}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成失敗");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSendBrief() {
    setSendingBrief(true);
    try {
      const result = await sendLineBrief();
      if (result.sent) {
        toast.success("LINE 簡報已發送");
      } else if (result.skipped) {
        toast(`簡報已跳過：${result.reason}`);
      } else {
        toast.error(`發送失敗：${result.reason ?? "未知原因"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "發送失敗");
    } finally {
      setSendingBrief(false);
    }
  }

  const hasChanges =
    settings !== null &&
    (enabled !== (settings.obsidian_enabled === "true") ||
      vaultPath !== settings.obsidian_vault_path ||
      inboxFolder !== settings.obsidian_inbox_folder ||
      exportMode !== settings.obsidian_export_mode);

  const hasDashboardChanges =
    settings !== null &&
    (recentDays !== (settings.recent_days ?? "7") || staleDays !== (settings.stale_days ?? "14"));

  const hasDailyNoteChanges =
    settings !== null &&
    (dailyNoteEnabled !== (settings.daily_note_enabled === "true") ||
      dailyFolder !== (settings.obsidian_daily_folder ?? "Daily") ||
      dailyNoteTime !== (settings.daily_note_time ?? "23:00") ||
      dailyNoteMode !== (settings.daily_note_mode ?? "subfolder"));

  const hasLineBriefChanges =
    settings !== null &&
    (lineBriefEnabled !== (settings.line_brief_enabled === "true") ||
      lineBriefTime !== (settings.line_brief_time ?? "21:00"));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto pb-4">
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
              <Select
                value={exportMode}
                onValueChange={(v) => setExportMode(v as "new" | "overwrite")}
                disabled={!enabled}
              >
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
              <Button
                onClick={handleSave}
                disabled={saving || !hasChanges || !isOnline}
                className="gap-1.5"
              >
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

        {/* Section 2: Obsidian Daily Note */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">Obsidian Daily Note</h2>
          </div>

          <div className="border rounded-lg p-4 space-y-4">
            {!enabled && (
              <p className="text-sm text-muted-foreground">請先在上方啟用 Obsidian 匯出</p>
            )}

            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">啟用每日筆記</p>
                <p className="text-xs text-muted-foreground">
                  每日自動生成 Obsidian daily note 並寫入 vault
                </p>
              </div>
              <Button
                variant={dailyNoteEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => setDailyNoteEnabled(!dailyNoteEnabled)}
                disabled={!enabled}
              >
                {dailyNoteEnabled ? "已啟用" : "已停用"}
              </Button>
            </div>

            {/* Daily folder */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">Daily Note 資料夾</label>
              <Input
                value={dailyFolder}
                onChange={(e) => setDailyFolder(e.target.value)}
                placeholder="Daily"
                disabled={!enabled || !dailyNoteEnabled}
              />
              <p className="text-xs text-muted-foreground mt-1">相對於 vault 根目錄的資料夾名稱</p>
            </div>

            {/* Daily note time */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">生成時間</label>
              <Input
                type="time"
                value={dailyNoteTime}
                onChange={(e) => setDailyNoteTime(e.target.value)}
                disabled={!enabled || !dailyNoteEnabled}
              />
              <p className="text-xs text-muted-foreground mt-1">每日自動生成時間（伺服器時區）</p>
            </div>

            {/* Daily note mode */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">寫入模式</label>
              <Select
                value={dailyNoteMode}
                onValueChange={(v) => setDailyNoteMode(v as "subfolder" | "append")}
                disabled={!enabled || !dailyNoteEnabled}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="subfolder">獨立檔案</SelectItem>
                  <SelectItem value="append">追加模式</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Generate + Save buttons */}
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={handleGenerateDailyNote}
                disabled={generating || !isOnline || settings?.obsidian_enabled !== "true"}
                className="gap-1.5"
              >
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                立即生成
              </Button>
              <Button
                onClick={handleSaveDailyNote}
                disabled={savingDailyNote || !hasDailyNoteChanges || !isOnline}
                className="gap-1.5"
              >
                {savingDailyNote ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                儲存設定
              </Button>
            </div>
          </div>
        </section>

        {/* Section 3: Dashboard Settings */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">Dashboard 設定</h2>
          </div>

          <div className="border rounded-lg p-4 space-y-4">
            <div>
              <label className="text-sm text-muted-foreground block mb-1">最近新增天數</label>
              <Input
                type="number"
                min={1}
                max={365}
                value={recentDays}
                onChange={(e) => setRecentDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Dashboard「最近新增」卡片顯示最近幾天的項目
              </p>
            </div>

            <div>
              <label className="text-sm text-muted-foreground block mb-1">過期筆記天數</label>
              <Input
                type="number"
                min={1}
                max={365}
                value={staleDays}
                onChange={(e) => setStaleDays(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">發展中筆記超過幾天未更新視為過期</p>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSaveDashboard}
                disabled={savingDashboard || !hasDashboardChanges || !isOnline}
                className="gap-1.5"
              >
                {savingDashboard ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                儲存設定
              </Button>
            </div>
          </div>
        </section>

        {/* Section 4: LINE Brief */}
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-muted-foreground">LINE 每日簡報</h2>
          </div>

          <div className="border rounded-lg p-4 space-y-4">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">啟用每日簡報</p>
                <p className="text-xs text-muted-foreground">每日自動透過 LINE 推送活動摘要</p>
              </div>
              <Button
                variant={lineBriefEnabled ? "default" : "outline"}
                size="sm"
                onClick={() => setLineBriefEnabled(!lineBriefEnabled)}
              >
                {lineBriefEnabled ? "已啟用" : "已停用"}
              </Button>
            </div>

            {/* Brief time */}
            <div>
              <label className="text-sm text-muted-foreground block mb-1">推送時間</label>
              <Input
                type="time"
                value={lineBriefTime}
                onChange={(e) => setLineBriefTime(e.target.value)}
                disabled={!lineBriefEnabled}
              />
              <p className="text-xs text-muted-foreground mt-1">每日簡報推送時間（伺服器時區）</p>
            </div>

            {/* Save + Send buttons */}
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={handleSendBrief}
                disabled={sendingBrief || !isOnline}
                className="gap-1.5"
              >
                {sendingBrief ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                立即發送
              </Button>
              <Button
                onClick={handleSaveLineBrief}
                disabled={savingLineBrief || !hasLineBriefChanges || !isOnline}
                className="gap-1.5"
              >
                {savingLineBrief ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                儲存設定
              </Button>
            </div>
          </div>
        </section>

        {/* Section 5: Category Management */}
        <CategoryManagement />

        {/* Section 6: General */}
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
              disabled={!isOnline}
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
