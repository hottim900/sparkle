import type { LucideIcon } from "lucide-react";
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
  Settings,
  StickyNote,
  Share2,
  Lock,
  ListTodo,
  Search,
} from "lucide-react";

export interface NavItemConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

export interface NavGroupConfig {
  label?: string;
  items: NavItemConfig[];
}

/**
 * Full sidebar navigation groups — used by the desktop sidebar.
 */
export const sidebarNavGroups: NavGroupConfig[] = [
  {
    items: [{ id: "dashboard", label: "總覽", icon: LayoutDashboard, path: "/dashboard" }],
  },
  {
    label: "筆記",
    items: [
      { id: "fleeting", label: "閃念", icon: Sparkles, path: "/notes/fleeting" },
      { id: "developing", label: "發展中", icon: Pencil, path: "/notes/developing" },
      { id: "permanent", label: "永久筆記", icon: Gem, path: "/notes/permanent" },
      { id: "exported", label: "已匯出", icon: ExternalLink, path: "/notes/exported" },
    ],
  },
  {
    label: "待辦",
    items: [
      { id: "active", label: "進行中", icon: PlayCircle, path: "/todos" },
      { id: "done", label: "已完成", icon: CheckCircle, path: "/todos/done" },
    ],
  },
  {
    label: "暫存",
    items: [{ id: "draft", label: "暫存區", icon: StickyNote, path: "/scratch" }],
  },
  {
    label: "私密",
    items: [{ id: "private", label: "私密筆記", icon: Lock, path: "/private" }],
  },
  {
    label: "共用",
    items: [
      { id: "all", label: "全部", icon: FileText, path: "/all" },
      { id: "archived", label: "已封存", icon: Archive, path: "/archived" },
      { id: "shares", label: "分享管理", icon: Share2, path: "/shares" },
    ],
  },
];

/**
 * Bottom nav main items — shown in the mobile bottom bar.
 * `path: null` means a non-routed action (e.g. search).
 */
export const bottomNavMainItems: (
  | NavItemConfig
  | { id: string; label: string; icon: LucideIcon; path: null }
)[] = [
  { id: "notes", label: "筆記", icon: FileText, path: "/notes/fleeting" },
  { id: "todos", label: "待辦", icon: ListTodo, path: "/todos" },
  { id: "scratch", label: "暫存", icon: StickyNote, path: "/scratch" },
  { id: "dashboard", label: "儀表板", icon: LayoutDashboard, path: "/dashboard" },
  { id: "search", label: "搜尋", icon: Search, path: null },
];

/**
 * Bottom nav "more" items — shown in the overflow menu.
 */
export const bottomNavMoreItems: NavItemConfig[] = [
  { id: "private", label: "私密筆記", icon: Lock, path: "/private" },
  { id: "all", label: "全部", icon: FileText, path: "/all" },
  { id: "archived", label: "已封存", icon: Archive, path: "/archived" },
  { id: "shares", label: "分享管理", icon: Share2, path: "/shares" },
  { id: "settings", label: "設定", icon: Settings, path: "/settings" },
];

/**
 * Check if a navigation item is active given the current pathname.
 * Supports both exact view matching and aggregate path matching
 * (e.g. "notes" is active for any /notes/* path).
 */
export function isViewActive(
  pathname: string,
  itemId: string,
  pathToView: (p: string) => string | undefined,
): boolean {
  const currentView = pathToView(pathname);
  if (currentView === itemId) return true;

  if (itemId === "notes" && pathname.startsWith("/notes")) return true;
  if (itemId === "todos" && pathname.startsWith("/todos")) return true;
  if (itemId === "scratch" && pathname.startsWith("/scratch")) return true;

  return false;
}
