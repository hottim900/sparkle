import { useState } from "react";
import type { ViewType } from "@/lib/types";
import {
  FileText,
  ListTodo,
  LayoutDashboard,
  Search,
  Menu,
  Archive,
  Settings,
  StickyNote,
} from "lucide-react";

interface BottomNavProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const mainNavItems: { id: ViewType; label: string; icon: React.ReactNode }[] = [
  { id: "notes", label: "筆記", icon: <FileText className="h-5 w-5" /> },
  { id: "todos", label: "待辦", icon: <ListTodo className="h-5 w-5" /> },
  { id: "scratch", label: "暫存", icon: <StickyNote className="h-5 w-5" /> },
  { id: "dashboard", label: "儀表板", icon: <LayoutDashboard className="h-5 w-5" /> },
  { id: "search", label: "搜尋", icon: <Search className="h-5 w-5" /> },
];

const moreItems: { id: ViewType; label: string; icon: React.ReactNode }[] = [
  { id: "all", label: "全部", icon: <FileText className="h-4 w-4" /> },
  { id: "archived", label: "已封存", icon: <Archive className="h-4 w-4" /> },
  { id: "settings", label: "設定", icon: <Settings className="h-4 w-4" /> },
];

export function BottomNav({ currentView, onViewChange }: BottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const isMoreActive = moreItems.some((item) => item.id === currentView);

  return (
    <>
      {/* More sheet overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="absolute bottom-14 right-2 bg-popover border rounded-lg shadow-lg p-2 min-w-[120px]"
            onClick={(e) => e.stopPropagation()}
          >
            {moreItems.map((item) => (
              <button
                key={item.id}
                className={`flex items-center gap-2 w-full px-3 py-2 rounded text-sm ${
                  currentView === item.id
                    ? "text-primary bg-accent"
                    : "text-muted-foreground hover:bg-accent"
                }`}
                onClick={() => {
                  onViewChange(item.id);
                  setMoreOpen(false);
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-card border-t z-40 md:hidden safe-area-pb">
        <div className="flex justify-around">
          {mainNavItems.map((item) => (
            <button
              key={item.id}
              className={`flex flex-col items-center py-2 px-3 flex-1 ${
                currentView === item.id ? "text-primary" : "text-muted-foreground"
              }`}
              onClick={() => onViewChange(item.id)}
            >
              {item.icon}
              <span className="text-xs mt-0.5">{item.label}</span>
            </button>
          ))}
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
    </>
  );
}
