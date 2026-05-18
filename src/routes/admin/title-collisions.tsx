import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listTitleCollisions } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

/**
 * Admin page: items_active rows that share a normalized title.
 * These are pre-Pre-PR0e (PR 5) duplicates — new writes are blocked by
 * the TITLE_COLLISION 409, but legacy duplicates need manual rename or
 * merge. Allowlist (`未命名`) excluded.
 *
 * Each group shows the rows sorted by modified DESC so the operator
 * can see the newest first and click through to rename / merge.
 */
function TitleCollisionsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "title-collisions"],
    queryFn: listTitleCollisions,
  });

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">載入中…</div>;
  }
  if (error) {
    return (
      <div className="p-6 text-destructive">
        無法載入：{error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  const collisions = data?.collisions ?? [];

  return (
    <div className="flex-1 min-w-0 p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">標題衝突</h1>
        <p className="text-sm text-muted-foreground">
          {data?.total ?? 0} 組 normalize 後相同標題的活躍項目。新寫入已由 TITLE_COLLISION
          阻擋；這裡是 PR 5 之前的舊資料，需要手動 rename 或合併。
        </p>
      </header>

      {collisions.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">無標題衝突 🎉</div>
      ) : (
        <div className="space-y-6">
          {collisions.map((group) => (
            <section key={group.normalized} className="rounded-md border">
              <header className="px-4 py-2 bg-muted/50 flex items-center gap-2">
                <code className="text-sm font-mono">{group.normalized}</code>
                <Badge variant="secondary">{group.rows.length} 筆</Badge>
              </header>
              <ul className="divide-y">
                {group.rows.map((row) => (
                  <li key={row.id} className="px-4 py-2 flex items-center gap-3">
                    <Link
                      to="/item/$id"
                      params={{ id: row.id }}
                      className="flex-1 text-primary underline decoration-dotted underline-offset-2 hover:no-underline min-w-0 truncate"
                      title={row.title}
                    >
                      {row.title}
                    </Link>
                    <Badge variant="outline" className="text-xs">
                      {row.type}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {row.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(row.modified).toLocaleDateString("zh-TW")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/admin/title-collisions")({
  component: TitleCollisionsPage,
});
