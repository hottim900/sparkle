import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "./search-bar";
import { getTags, exportData, importData } from "@/lib/api";
import { clearToken } from "@/lib/api";
import type { ViewType, ParsedItem } from "@/lib/types";
import {
  Sparkles,
  Pencil,
  Gem,
  ExternalLink,
  PlayCircle,
  CheckCircle,
  Archive,
  LayoutDashboard,
  FileText,
  LogOut,
  Sun,
  Moon,
  Download,
  Upload,
  Settings,
} from "lucide-react";

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  selectedTag?: string;
  onTagSelect: (tag: string | undefined) => void;
  onSearchSelect?: (item: ParsedItem) => void;
}

type NavItem = { id: ViewType; label: string; icon: React.ReactNode };
type NavGroup = { label?: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    items: [
      { id: "dashboard", label: "總覽", icon: <LayoutDashboard className="h-4 w-4" /> },
    ],
  },
  {
    label: "筆記",
    items: [
      { id: "fleeting", label: "閃念", icon: <Sparkles className="h-4 w-4" /> },
      { id: "developing", label: "發展中", icon: <Pencil className="h-4 w-4" /> },
      { id: "permanent", label: "永久筆記", icon: <Gem className="h-4 w-4" /> },
      { id: "exported", label: "已匯出", icon: <ExternalLink className="h-4 w-4" /> },
    ],
  },
  {
    label: "待辦",
    items: [
      { id: "active", label: "進行中", icon: <PlayCircle className="h-4 w-4" /> },
      { id: "done", label: "已完成", icon: <CheckCircle className="h-4 w-4" /> },
    ],
  },
  {
    label: "共用",
    items: [
      { id: "all", label: "全部", icon: <FileText className="h-4 w-4" /> },
      { id: "archived", label: "已封存", icon: <Archive className="h-4 w-4" /> },
    ],
  },
];

export function Sidebar({
  currentView,
  onViewChange,
  selectedTag,
  onTagSelect,
  onSearchSelect,
}: SidebarProps) {
  const [tags, setTags] = useState<string[]>([]);
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    getTags()
      .then((res) => setTags(res.tags))
      .catch(() => {});
  }, []);

  return (
    <div className="w-64 border-r h-full flex flex-col bg-card">
      {/* Search */}
      <div className="p-3 border-b">
        <SearchBar onSelect={onSearchSelect} />
      </div>

      {/* Views */}
      <nav className="p-2 space-y-1">
        {navGroups.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="text-xs text-muted-foreground px-3 pt-3 pb-1 font-medium">
                {group.label}
              </p>
            )}
            {group.items.map((v) => (
              <Button
                key={v.id}
                variant={currentView === v.id ? "secondary" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => {
                  onViewChange(v.id);
                  onTagSelect(undefined);
                }}
              >
                {v.icon}
                {v.label}
              </Button>
            ))}
          </div>
        ))}
      </nav>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="px-3 py-2 border-t flex-1 overflow-y-auto">
          <p className="text-xs text-muted-foreground mb-2 font-medium">
            標籤
          </p>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant={selectedTag === tag ? "default" : "secondary"}
                className="cursor-pointer"
                onClick={() =>
                  onTagSelect(selectedTag === tag ? undefined : tag)
                }
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Settings + Theme toggle + Export/Import + Logout */}
      <div className="p-2 border-t space-y-1">
        <Button
          variant={currentView === "settings" ? "secondary" : "ghost"}
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => {
            onViewChange("settings");
            onTagSelect(undefined);
          }}
        >
          <Settings className="h-4 w-4" />
          設定
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          {theme === "dark" ? "淺色模式" : "深色模式"}
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
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-muted-foreground"
          onClick={() => {
            clearToken();
            window.location.reload();
          }}
        >
          <LogOut className="h-4 w-4" />
          登出
        </Button>
        <p className="hidden md:block text-xs text-muted-foreground px-2 pt-1">
          快捷鍵：N 新增 / 搜尋 Esc 關閉
        </p>
      </div>
    </div>
  );
}
