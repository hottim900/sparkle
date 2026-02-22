import type { ViewType } from "@/lib/types";
import { Inbox, Zap, FileText, Search } from "lucide-react";

interface BottomNavProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const navItems: { id: ViewType; label: string; icon: React.ReactNode }[] = [
  { id: "inbox", label: "收件匣", icon: <Inbox className="h-5 w-5" /> },
  { id: "active", label: "進行中", icon: <Zap className="h-5 w-5" /> },
  { id: "all", label: "筆記", icon: <FileText className="h-5 w-5" /> },
  { id: "search", label: "搜尋", icon: <Search className="h-5 w-5" /> },
];

export function BottomNav({ currentView, onViewChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-card border-t z-40 md:hidden safe-area-pb">
      <div className="flex justify-around">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`flex flex-col items-center py-2 px-3 flex-1 ${
              currentView === item.id
                ? "text-primary"
                : "text-muted-foreground"
            }`}
            onClick={() => onViewChange(item.id)}
          >
            {item.icon}
            <span className="text-xs mt-0.5">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
