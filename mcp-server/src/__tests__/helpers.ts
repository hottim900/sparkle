import type { SparkleItem, StatsResponse } from "../types.js";

/** Factory for SparkleItem with sensible defaults */
export function makeItem(overrides: Partial<SparkleItem> = {}): SparkleItem {
  return {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    type: "note",
    title: "Test Note",
    content: "Some content here.",
    status: "fleeting",
    priority: null,
    due: null,
    tags: "[]",
    source: null,
    origin: "web",
    aliases: "[]",
    linked_note_id: null,
    linked_note_title: null,
    linked_todo_count: 0,
    share_visibility: null,
    created: "2026-01-15T10:00:00.000Z",
    modified: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

/** Factory for StatsResponse with zeroed defaults */
export function makeStats(overrides: Partial<StatsResponse> = {}): StatsResponse {
  return {
    fleeting_count: 0,
    developing_count: 0,
    permanent_count: 0,
    exported_this_week: 0,
    exported_this_month: 0,
    active_count: 0,
    done_this_week: 0,
    done_this_month: 0,
    created_this_week: 0,
    created_this_month: 0,
    overdue_count: 0,
    ...overrides,
  };
}

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

/** Mock McpServer that captures tool registrations */
export function makeMockServer() {
  const tools = new Map<string, ToolHandler>();

  return {
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      tools.set(name, handler);
    },
    registerResource() {},
    getHandler(name: string): ToolHandler {
      const handler = tools.get(name);
      if (!handler) throw new Error(`Tool "${name}" not registered`);
      return handler;
    },
  };
}
