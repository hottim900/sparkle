import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { Category } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { Tag, Plus, X, Pencil, ChevronUp, ChevronDown, Trash2 } from "lucide-react";

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

export function CategoryManagement() {
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState<string | null>(null);
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () =>
      listCategories().then((r) => r.categories.sort((a, b) => a.sort_order - b.sort_order)),
  });

  const createMutation = useMutation({
    mutationFn: (params: { name: string; color?: string | null }) => createCategory(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      toast.success("已建立分類");
      cancelForm();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "建立分類失敗");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...params }: { id: string; name: string; color: string | null }) =>
      updateCategory(id, params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      toast.success("已更新分類");
      cancelForm();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "更新分類失敗");
    },
  });

  const startCreate = () => {
    setEditingId(null);
    setIsCreating(true);
    setFormName("");
    setFormColor(null);
  };

  const startEdit = (cat: Category) => {
    setIsCreating(false);
    setEditingId(cat.id);
    setFormName(cat.name);
    setFormColor(cat.color);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingId(null);
    setFormName("");
    setFormColor(null);
  };

  const handleCreate = () => {
    const name = formName.trim();
    if (!name) return;
    createMutation.mutate({ name, color: formColor });
  };

  const reorderMutation = useMutation({
    mutationFn: (items: { id: string; sort_order: number }[]) => reorderCategories(items),
    onMutate: async (newItems) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.categories });
      const previous = queryClient.getQueryData<Category[]>(queryKeys.categories);
      queryClient.setQueryData<Category[]>(queryKeys.categories, (old) => {
        if (!old) return old;
        const orderMap = new Map(newItems.map((i) => [i.id, i.sort_order]));
        return [...old]
          .map((cat) => ({
            ...cat,
            sort_order: orderMap.get(cat.id) ?? cat.sort_order,
          }))
          .sort((a, b) => a.sort_order - b.sort_order);
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.categories, context.previous);
      }
      toast.error("排序失敗");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      toast.success("已刪除分類");
      setDeleteDialogId(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "刪除分類失敗");
    },
  });

  const handleUpdate = () => {
    const name = formName.trim();
    if (!name || !editingId) return;
    updateMutation.mutate({ id: editingId, name, color: formColor });
  };

  const handleMove = (index: number, direction: "up" | "down") => {
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    const swapCat = categories[swapIndex];
    const currentCat = categories[index];
    if (!swapCat || !currentCat) return;
    const newItems = categories.map((cat, i) => {
      if (i === index) return { id: cat.id, sort_order: swapCat.sort_order };
      if (i === swapIndex) return { id: cat.id, sort_order: currentCat.sort_order };
      return { id: cat.id, sort_order: cat.sort_order };
    });
    reorderMutation.mutate(newItems);
  };

  const renderInlineForm = (mode: "create" | "edit") => (
    <div className="mt-3 space-y-3 rounded-md border p-3">
      <Input
        placeholder="分類名稱"
        value={formName}
        onChange={(e) => setFormName(e.target.value)}
      />
      <div className="flex items-center gap-1.5">
        {PRESET_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            data-testid={`color-${color}`}
            className={`size-6 rounded-full transition-all ${
              formColor === color ? "ring-2 ring-offset-2 ring-primary" : ""
            }`}
            style={{ backgroundColor: color }}
            onClick={() => setFormColor(color)}
          />
        ))}
        {formColor && (
          <button
            type="button"
            className="ml-1 text-muted-foreground hover:text-foreground"
            onClick={() => setFormColor(null)}
            title="清除顏色"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={mode === "create" ? handleCreate : handleUpdate}
          disabled={!formName.trim()}
        >
          {mode === "create" ? "新增" : "儲存"}
        </Button>
        <Button size="sm" variant="outline" onClick={cancelForm}>
          取消
        </Button>
      </div>
    </div>
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground">分類管理</h2>
      </div>

      <div className="border rounded-lg p-4">
        {categories.length === 0 && !isCreating ? (
          <div className="text-center py-8 space-y-2">
            <Tag className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">尚無分類</p>
            <p className="text-xs text-muted-foreground">點擊下方按鈕建立第一個分類。</p>
          </div>
        ) : (
          <div className="space-y-1">
            {categories.map((cat, index) =>
              editingId === cat.id ? (
                <div key={cat.id}>{renderInlineForm("edit")}</div>
              ) : (
                <div
                  key={cat.id}
                  data-testid="category-row"
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  {cat.color && (
                    <span
                      data-testid="category-color-dot"
                      className="inline-block size-3 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                  )}
                  <span className="flex-1 text-sm">{cat.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    title="編輯"
                    disabled={!isOnline}
                    onClick={() => startEdit(cat)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {index > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title="上移"
                      disabled={!isOnline}
                      onClick={() => handleMove(index, "up")}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {index < categories.length - 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title="下移"
                      disabled={!isOnline}
                      onClick={() => handleMove(index, "down")}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Dialog
                    open={deleteDialogId === cat.id}
                    onOpenChange={(open) => setDeleteDialogId(open ? cat.id : null)}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-destructive"
                      title="刪除"
                      disabled={!isOnline}
                      onClick={() => setDeleteDialogId(cat.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>確認刪除分類</DialogTitle>
                        <DialogDescription>
                          刪除「{cat.name}」？相關項目將變為未分類。
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteDialogId(null)}>
                          取消
                        </Button>
                        <Button variant="destructive" onClick={() => deleteMutation.mutate(cat.id)}>
                          刪除
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              ),
            )}
          </div>
        )}

        {isCreating && renderInlineForm("create")}

        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={!isOnline}
            onClick={startCreate}
          >
            <Plus className="h-4 w-4" />
            新增分類
          </Button>
        </div>
      </div>
    </section>
  );
}
