import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState, type NavigateOptions } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "./search-bar";
import { getTags } from "@/lib/api";
import { clearToken } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { pathToView } from "@/lib/navigation";
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
  Settings,
  StickyNote,
  Share2,
  Lock,
} from "lucide-react";

type NavItem = { id: string; label: string; icon: React.ReactNode; path: string };
type NavGroup = { label?: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    items: [
      {
        id: "dashboard",
        label: "總覽",
        icon: <LayoutDashboard className="h-4 w-4" />,
        path: "/dashboard",
      },
    ],
  },
  {
    label: "筆記",
    items: [
      {
        id: "fleeting",
        label: "閃念",
        icon: <Sparkles className="h-4 w-4" />,
        path: "/notes/fleeting",
      },
      {
        id: "developing",
        label: "發展中",
        icon: <Pencil className="h-4 w-4" />,
        path: "/notes/developing",
      },
      {
        id: "permanent",
        label: "永久筆記",
        icon: <Gem className="h-4 w-4" />,
        path: "/notes/permanent",
      },
      {
        id: "exported",
        label: "已匯出",
        icon: <ExternalLink className="h-4 w-4" />,
        path: "/notes/exported",
      },
    ],
  },
  {
    label: "待辦",
    items: [
      { id: "active", label: "進行中", icon: <PlayCircle className="h-4 w-4" />, path: "/todos" },
      {
        id: "done",
        label: "已完成",
        icon: <CheckCircle className="h-4 w-4" />,
        path: "/todos/done",
      },
    ],
  },
  {
    label: "暫存",
    items: [
      { id: "draft", label: "暫存區", icon: <StickyNote className="h-4 w-4" />, path: "/scratch" },
    ],
  },
  {
    label: "私密",
    items: [
      { id: "private", label: "私密筆記", icon: <Lock className="h-4 w-4" />, path: "/private" },
    ],
  },
  {
    label: "共用",
    items: [
      { id: "all", label: "全部", icon: <FileText className="h-4 w-4" />, path: "/all" },
      { id: "archived", label: "已封存", icon: <Archive className="h-4 w-4" />, path: "/archived" },
      { id: "shares", label: "分享管理", icon: <Share2 className="h-4 w-4" />, path: "/shares" },
    ],
  },
];

export function Sidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentView = pathToView(pathname);

  const { data: tags = [] } = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => getTags().then((r) => r.tags),
  });

  const selectedTag = useRouterState({
    select: (s) => {
      const search = s.location.search as Record<string, unknown>;
      return typeof search.tag === "string" ? search.tag : undefined;
    },
  });

  return (
    <div data-testid="sidebar" className="w-64 border-r h-full flex flex-col bg-card">
      {/* Search */}
      <div className="p-3 border-b">
        <SearchBar
          onSelect={(item) => {
            navigate({
              search: (prev) => ({ ...prev, item: item.id }),
            } as NavigateOptions);
          }}
        />
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
                asChild
              >
                <Link to={v.path} search={{}}>
                  {v.icon}
                  {v.label}
                </Link>
              </Button>
            ))}
          </div>
        ))}
      </nav>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="px-3 py-2 border-t flex-1 overflow-y-auto">
          <p className="text-xs text-muted-foreground mb-2 font-medium">標籤</p>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant={selectedTag === tag ? "default" : "secondary"}
                className="cursor-pointer"
                onClick={() => {
                  const newTag = selectedTag === tag ? undefined : tag;
                  navigate({
                    search: (prev) => ({ ...prev, tag: newTag, item: undefined }),
                  } as NavigateOptions);
                }}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Settings + Logout */}
      <div className="p-2 border-t space-y-1">
        <Button
          variant={currentView === "settings" ? "secondary" : "ghost"}
          className="w-full justify-start gap-2 text-muted-foreground"
          asChild
        >
          <Link to="/settings" search={{}}>
            <Settings className="h-4 w-4" />
            設定
          </Link>
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
        <p className="hidden md:block text-xs text-muted-foreground px-2 pt-1">
          快捷鍵：N 新增 / 搜尋 Esc 關閉
        </p>
      </div>
    </div>
  );
}
