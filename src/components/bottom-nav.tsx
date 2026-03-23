import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { pathToView } from "@/lib/navigation";
import {
  FileText,
  ListTodo,
  LayoutDashboard,
  Search,
  Menu,
  Archive,
  Settings,
  StickyNote,
  Share2,
  Lock,
} from "lucide-react";

const mainNavItems = [
  { id: "notes", label: "筆記", icon: <FileText className="h-5 w-5" />, path: "/notes/fleeting" },
  { id: "todos", label: "待辦", icon: <ListTodo className="h-5 w-5" />, path: "/todos" },
  { id: "scratch", label: "暫存", icon: <StickyNote className="h-5 w-5" />, path: "/scratch" },
  {
    id: "dashboard",
    label: "儀表板",
    icon: <LayoutDashboard className="h-5 w-5" />,
    path: "/dashboard",
  },
  { id: "search", label: "搜尋", icon: <Search className="h-5 w-5" />, path: null },
];

const moreItems = [
  { id: "private", label: "私密筆記", icon: <Lock className="h-4 w-4" />, path: "/private" },
  { id: "all", label: "全部", icon: <FileText className="h-4 w-4" />, path: "/all" },
  { id: "archived", label: "已封存", icon: <Archive className="h-4 w-4" />, path: "/archived" },
  { id: "shares", label: "分享管理", icon: <Share2 className="h-4 w-4" />, path: "/shares" },
  { id: "settings", label: "設定", icon: <Settings className="h-4 w-4" />, path: "/settings" },
];

function isViewActive(pathname: string, itemId: string): boolean {
  const currentView = pathToView(pathname);
  if (currentView === itemId) return true;

  // Aggregate view matching: "notes" is active for any /notes/* path
  if (itemId === "notes" && pathname.startsWith("/notes")) return true;
  if (itemId === "todos" && pathname.startsWith("/todos")) return true;
  if (itemId === "scratch" && pathname.startsWith("/scratch")) return true;

  return false;
}

interface BottomNavProps {
  onSearchClick?: () => void;
}

export function BottomNav({ onSearchClick }: BottomNavProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = moreItems.some((item) => isViewActive(pathname, item.id));

  return (
    <nav className="relative bg-card border-t md:hidden pb-[env(safe-area-inset-bottom)]">
      {/* More menu overlay + popup */}
      {moreOpen && (
        <>
          <div
            data-testid="more-overlay"
            className="fixed inset-0 z-40"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="absolute bottom-full right-2 mb-2 z-40 bg-popover border rounded-lg shadow-lg p-2 min-w-[120px]"
            onClick={(e) => e.stopPropagation()}
          >
            {moreItems.map((item) => (
              <Link
                key={item.id}
                to={item.path}
                search={{}}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded text-sm ${
                  isViewActive(pathname, item.id)
                    ? "text-primary bg-accent"
                    : "text-muted-foreground hover:bg-accent"
                }`}
                onClick={() => setMoreOpen(false)}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-around">
        {mainNavItems.map((item) => {
          if (item.path === null) {
            // Search is a non-routed action
            return (
              <button
                key={item.id}
                className="flex flex-col items-center py-2 px-3 flex-1 text-muted-foreground"
                onClick={() => {
                  if (onSearchClick) {
                    onSearchClick();
                  } else {
                    const input = document.querySelector<HTMLInputElement>(
                      'input[placeholder="搜尋..."]',
                    );
                    input?.focus();
                  }
                }}
              >
                {item.icon}
                <span className="text-xs mt-0.5">{item.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.id}
              to={item.path}
              search={{}}
              className={`flex flex-col items-center py-2 px-3 flex-1 ${
                isViewActive(pathname, item.id) ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {item.icon}
              <span className="text-xs mt-0.5">{item.label}</span>
            </Link>
          );
        })}
        <button
          className={`flex flex-col items-center py-2 px-3 flex-1 ${
            isMoreActive || moreOpen ? "text-primary" : "text-muted-foreground"
          }`}
          onClick={() => setMoreOpen(!moreOpen)}
        >
          <Menu className="h-5 w-5" />
          <span className="text-xs mt-0.5">更多</span>
        </button>
      </div>
    </nav>
  );
}
