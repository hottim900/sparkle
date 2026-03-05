import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listCategories, createCategory } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tag, Plus, X } from "lucide-react";

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

  const [isCreating, setIsCreating] = useState(false);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState<string | null>(null);

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

  const startCreate = () => {
    setIsCreating(true);
    setFormName("");
    setFormColor(null);
  };

  const cancelForm = () => {
    setIsCreating(false);
    setFormName("");
    setFormColor(null);
  };

  const handleCreate = () => {
    const name = formName.trim();
    if (!name) return;
    createMutation.mutate({ name, color: formColor });
  };

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
            {categories.map((cat) => (
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
              </div>
            ))}
          </div>
        )}

        {isCreating && (
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
              <Button size="sm" onClick={handleCreate} disabled={!formName.trim()}>
                新增
              </Button>
              <Button size="sm" variant="outline" onClick={cancelForm}>
                取消
              </Button>
            </div>
          </div>
        )}

        <div className="mt-3">
          <Button variant="outline" size="sm" className="gap-1" onClick={startCreate}>
            <Plus className="h-4 w-4" />
            新增分類
          </Button>
        </div>
      </div>
    </section>
  );
}
