import { Archive, Trash2, Pencil, Gem, ExternalLink, CheckCircle } from "lucide-react";
import type { ItemStatus } from "@/lib/types";

export type BatchActionConfig = {
  action: string;
  label: string;
  icon: React.ReactNode;
  variant?: "destructive" | "ghost";
  confirm?: string;
};

export function getBatchActions(
  status?: ItemStatus,
  obsidianEnabled?: boolean,
): BatchActionConfig[] {
  const universal: BatchActionConfig[] = [
    { action: "archive", label: "封存", icon: <Archive className="h-3.5 w-3.5" /> },
    {
      action: "delete",
      label: "刪除",
      icon: <Trash2 className="h-3.5 w-3.5" />,
      variant: "destructive",
      confirm: "確定要刪除所選項目嗎？此操作無法復原。",
    },
  ];

  switch (status) {
    case "fleeting":
      return [
        { action: "develop", label: "發展", icon: <Pencil className="h-3.5 w-3.5" /> },
        ...universal,
      ];
    case "developing":
      return [
        { action: "mature", label: "成熟", icon: <Gem className="h-3.5 w-3.5" /> },
        ...universal,
      ];
    case "permanent": {
      const actions: BatchActionConfig[] = [];
      if (obsidianEnabled) {
        actions.push({
          action: "export",
          label: "匯出",
          icon: <ExternalLink className="h-3.5 w-3.5" />,
        });
      }
      return [...actions, ...universal];
    }
    case "active":
      return [
        { action: "done", label: "完成", icon: <CheckCircle className="h-3.5 w-3.5" /> },
        ...universal,
      ];
    case "draft":
      return [
        {
          action: "delete",
          label: "刪除",
          icon: <Trash2 className="h-3.5 w-3.5" />,
          variant: "destructive",
          confirm: "確定要刪除所選項目嗎？此操作無法復原。",
        },
        { action: "archive", label: "封存", icon: <Archive className="h-3.5 w-3.5" /> },
      ];
    default:
      return universal;
  }
}
