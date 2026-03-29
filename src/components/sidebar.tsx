import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState, type NavigateOptions } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchBar } from "./search-bar";
import { getTags, listItems } from "@/lib/api";
import { clearToken } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { pathToView } from "@/lib/navigation";
import { sidebarNavGroups } from "@/lib/nav-config";
import { LogOut, Settings } from "lucide-react";

export function Sidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const currentView = pathToView(pathname);

  const { data: tags = [] } = useQuery({
    queryKey: queryKeys.tags,
    queryFn: () => getTags().then((r) => r.tags),
  });

  const { data: pausedCount = 0 } = useQuery({
    queryKey: queryKeys.pausedCount,
    queryFn: () => listItems({ paused: "true", limit: 0 }).then((r) => r.total),
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
        {sidebarNavGroups.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <p className="text-xs text-muted-foreground px-3 pt-3 pb-1 font-medium">
                {group.label}
              </p>
            )}
            {group.items.map((v) => {
              const Icon = v.icon;
              const badgeCount = v.id === "paused" ? pausedCount : 0;
              return (
                <Button
                  key={v.id}
                  variant={currentView === v.id ? "secondary" : "ghost"}
                  className="w-full justify-start gap-2"
                  asChild
                >
                  <Link to={v.path} search={{}}>
                    <Icon className="h-4 w-4" />
                    {v.label}
                    {badgeCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-auto h-5 min-w-5 px-1 text-xs font-normal"
                      >
                        {badgeCount}
                      </Badge>
                    )}
                  </Link>
                </Button>
              );
            })}
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
