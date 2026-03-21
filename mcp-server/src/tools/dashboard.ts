import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUnreviewed, getRecent, getAttention, getDashboardStale } from "../client.js";
import { formatItemList } from "../format.js";
import { formatToolError } from "../utils.js";

export function registerDashboardTools(server: McpServer): void {
  server.registerTool(
    "sparkle_list_unreviewed",
    {
      title: "List Unreviewed Items",
      description:
        "列出尚未在 app 中開啟過的項目（透過 MCP 或 LINE 建立的）。用於查看哪些項目需要在 app 中確認或整理。",
      inputSchema: z
        .object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(20)
            .describe("回傳數量上限"),
          offset: z.number().int().min(0).default(0).describe("分頁偏移量"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit, offset }) => {
      try {
        const data = await getUnreviewed(limit, offset);
        const text = formatItemList(data.items, data.total, { offset, limit });
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_list_recent",
    {
      title: "List Recently Created Items",
      description:
        "列出最近 N 天內建立的項目（天數由 Sparkle settings 的 recent_days 控制，預設 7 天）。",
      inputSchema: z
        .object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(20)
            .describe("回傳數量上限"),
          offset: z.number().int().min(0).default(0).describe("分頁偏移量"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit, offset }) => {
      try {
        const data = await getRecent(limit, offset);
        const text = formatItemList(data.items, data.total, { offset, limit });
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_list_attention",
    {
      title: "List Items Needing Attention",
      description:
        "列出需要關注的項目：逾期待辦和高優先度項目。逾期項目排在最前面。",
      inputSchema: z
        .object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(10)
            .describe("回傳數量上限"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      try {
        const data = await getAttention(limit);
        const text = formatItemList(data.items, data.total);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_list_stale",
    {
      title: "List Stale Developing Notes",
      description:
        "列出長時間未更新的發展中筆記（天數由 Sparkle settings 的 stale_days 控制，預設 14 天）。",
      inputSchema: z
        .object({
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(10)
            .describe("回傳數量上限"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      try {
        const data = await getDashboardStale(limit);
        if (data.items.length === 0) {
          return { content: [{ type: "text", text: "No stale developing notes found." }] };
        }
        const lines: string[] = [
          `Found ${data.total} stale developing notes (showing ${data.items.length}):\n`,
        ];
        for (const item of data.items) {
          const catStr = item.category_name ? ` 📁${item.category_name}` : "";
          lines.push(
            `- **${item.title}** — ${item.days_stale} days stale${catStr}`,
          );
          lines.push(`  ID: ${item.id} | Modified: ${item.modified}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
