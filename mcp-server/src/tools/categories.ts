import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listCategories,
  createCategoryApi,
  updateCategoryApi,
  deleteCategoryApi,
} from "../client.js";
import type { Category } from "../types.js";

function formatCategory(cat: Category): string {
  const color = cat.color ? ` (${cat.color})` : "";
  return `- **${cat.name}**${color} — ID: ${cat.id} | Order: ${cat.sort_order}`;
}

function formatCategoryList(categories: Category[]): string {
  if (categories.length === 0) return "No categories found.";
  const lines = [`Found ${categories.length} categories:\n`];
  for (const cat of categories) {
    lines.push(formatCategory(cat));
  }
  return lines.join("\n");
}

function formatCategoryDetail(cat: Category): string {
  const lines = [
    `**${cat.name}**`,
    `- ID: ${cat.id}`,
    `- Color: ${cat.color ?? "none"}`,
    `- Sort order: ${cat.sort_order}`,
    `- Created: ${cat.created}`,
    `- Modified: ${cat.modified}`,
  ];
  return lines.join("\n");
}

export function registerCategoryTools(server: McpServer): void {
  server.registerTool(
    "sparkle_list_categories",
    {
      title: "List Categories",
      description: `List all categories in Sparkle, sorted by sort_order.

No args required.

Returns: Array of categories with name, color, sort_order, and metadata.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const data = await listCategories();
        const text = formatCategoryList(data.categories);
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error listing categories: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "sparkle_create_category",
    {
      title: "Create Category",
      description: `Create a new category for organizing items.

Args:
  - name (string, required): Category name (1-50 chars, must be unique)
  - color (string, optional): Color value (max 20 chars, e.g. "blue", "#3b82f6")

Returns: The created category with all fields.`,
      inputSchema: {
        name: z.string().min(1).max(50).describe("Category name"),
        color: z.string().max(20).nullable().optional().describe("Color value"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ name, color }) => {
      try {
        const cat = await createCategoryApi({ name, color: color ?? null });
        const text = `Category created successfully.\n\n${formatCategoryDetail(cat)}`;
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error creating category: ${(error as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "sparkle_update_category",
    {
      title: "Update Category",
      description: `Update an existing category's name, color, or sort order.

Args:
  - id (string, required): Category UUID
  - name (string, optional): New name (1-50 chars, must be unique)
  - color (string, optional): New color value (max 20 chars, null to clear)
  - sort_order (number, optional): New sort position (integer >= 0)

Returns: The updated category with all fields.`,
      inputSchema: {
        id: z.string().uuid().describe("Category UUID"),
        name: z.string().min(1).max(50).optional().describe("New name"),
        color: z.string().max(20).nullable().optional().describe("Color value (null to clear)"),
        sort_order: z.number().int().min(0).optional().describe("Sort position"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ id, name, color, sort_order }) => {
      try {
        const update: Record<string, unknown> = {};
        if (name !== undefined) update.name = name;
        if (color !== undefined) update.color = color;
        if (sort_order !== undefined) update.sort_order = sort_order;

        const cat = await updateCategoryApi(id, update);
        const text = `Category updated successfully.\n\n${formatCategoryDetail(cat)}`;
        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error updating category: ${(error as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "sparkle_delete_category",
    {
      title: "Delete Category",
      description: `Delete a category. Items assigned to this category will have their category_id set to null (ON DELETE SET NULL).

Args:
  - id (string, required): Category UUID

Returns: Confirmation of deletion.`,
      inputSchema: {
        id: z.string().uuid().describe("Category UUID"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      try {
        await deleteCategoryApi(id);
        return {
          content: [{ type: "text", text: "Category deleted successfully." }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error deleting category: ${(error as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );
}
