import { useQuery } from "@tanstack/react-query";
import { listCategories } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { Tag } from "lucide-react";

export function CategoryManagement() {
  const { data: categories = [] } = useQuery({
    queryKey: queryKeys.categories,
    queryFn: () =>
      listCategories().then((r) => r.categories.sort((a, b) => a.sort_order - b.sort_order)),
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Tag className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-muted-foreground">分類管理</h2>
      </div>

      <div className="border rounded-lg p-4">
        {categories.length === 0 ? (
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
      </div>
    </section>
  );
}
