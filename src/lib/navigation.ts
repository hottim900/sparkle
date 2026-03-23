const VIEW_TO_PATH: Record<string, string> = {
  dashboard: "/dashboard",
  fleeting: "/notes/fleeting",
  developing: "/notes/developing",
  permanent: "/notes/permanent",
  exported: "/notes/exported",
  active: "/todos",
  done: "/todos/done",
  draft: "/scratch",
  notes: "/notes/fleeting",
  todos: "/todos",
  scratch: "/scratch",
  all: "/all",
  archived: "/archived",
  settings: "/settings",
  shares: "/shares",
  private: "/private",
  search: "/", // search is a non-routed overlay, fallback to root
};

const PATH_TO_VIEW: Record<string, string> = {
  "/dashboard": "dashboard",
  "/notes/fleeting": "fleeting",
  "/notes/developing": "developing",
  "/notes/permanent": "permanent",
  "/notes/exported": "exported",
  "/todos": "active",
  "/todos/done": "done",
  "/scratch": "draft",
  "/all": "all",
  "/archived": "archived",
  "/settings": "settings",
  "/shares": "shares",
  "/private": "private",
};

export function viewToPath(view: string): string {
  return VIEW_TO_PATH[view] ?? "/";
}

export function pathToView(path: string): string | undefined {
  return PATH_TO_VIEW[path];
}

/** Routes that use the list+detail split panel layout */
export const LIST_ROUTE_PREFIXES = [
  "/notes",
  "/todos",
  "/scratch",
  "/all",
  "/archived",
  "/unreviewed",
  "/recent",
  "/attention",
  "/stale",
] as const;

export function isListRoute(path: string): boolean {
  return LIST_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + "/"));
}
