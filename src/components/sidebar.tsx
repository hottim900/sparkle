import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "./search-bar";
import { getTags } from "@/lib/api";
import { clearToken } from "@/lib/api";
import type { ViewType, ParsedItem } from "@/lib/types";
import {
  Inbox,
  Zap,
  FileText,
  CheckCircle,
  Archive,
  ListTodo,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  selectedTag?: string;
  onTagSelect: (tag: string | undefined) => void;
  onSearchSelect?: (item: ParsedItem) => void;
}

const views: { id: ViewType; label: string; icon: React.ReactNode }[] = [
  { id: "inbox", label: "收件匣", icon: <Inbox className="h-4 w-4" /> },
  { id: "active", label: "進行中", icon: <Zap className="h-4 w-4" /> },
  { id: "all", label: "全部", icon: <FileText className="h-4 w-4" /> },
  { id: "done", label: "已完成", icon: <CheckCircle className="h-4 w-4" /> },
  {
    id: "archived",
    label: "已封存",
    icon: <Archive className="h-4 w-4" />,
  },
  {
    id: "triage",
    label: "分類模式",
    icon: <ListTodo className="h-4 w-4" />,
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
        {views.map((v) => (
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

      {/* Theme toggle + Logout */}
      <div className="p-2 border-t space-y-1">
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
          onClick={() => {
            clearToken();
            window.location.reload();
          }}
        >
          <LogOut className="h-4 w-4" />
          登出
        </Button>
      </div>
    </div>
  );
}
