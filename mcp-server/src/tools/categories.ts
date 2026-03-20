import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  listCategories,
  createCategoryApi,
  updateCategoryApi,
  deleteCategoryApi,
  reorderCategoriesApi,
} from "../client.js";
import type { Category } from "../types.js";
import { formatToolError } from "../utils.js";

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

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
      description: `List all categories in Sparkle, sorted by display order.

Use this before assigning a category_id via sparkle_create_note or sparkle_update_note to find the correct UUID. Also useful for checking existing categories before creating a new one to avoid duplicates.

Returns: Array of categories with name, color (hex), sort_order, and metadata.`,
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
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_create_category",
    {
      title: "Create Category",
      description: `Create a new category for organizing items.

Before creating, use sparkle_list_categories to check if a similar category already exists. Category names must be unique. Items can be assigned to a category via category_id in sparkle_create_note or sparkle_update_note.

Args:
  - name (string, required): Category name (1-50 chars, must be unique)
  - color (string, optional): Hex color code (e.g. "#3b82f6"), must be #RRGGBB format. Null to leave unset.

Returns: The created category with all fields.`,
      inputSchema: {
        name: z.string().min(1).max(50).describe("Category name"),
        color: z
          .string()
          .regex(HEX_COLOR_REGEX)
          .nullable()
          .optional()
          .describe("Hex color code (#RRGGBB format, e.g. #3b82f6)"),
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
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_update_category",
    {
      title: "Update Category",
      description: `Update an existing category's name, color, or sort order.

Use sparkle_list_categories to find the category UUID first. Only provided fields are updated; omitted fields remain unchanged.

Args:
  - id (string, required): Category UUID
  - name (string, optional): New name (1-50 chars, must be unique)
  - color (string, optional): Hex color code (#RRGGBB format), or null to clear
  - sort_order (number, optional): New sort position (integer >= 0)

Returns: The updated category with all fields.`,
      inputSchema: {
        id: z.string().uuid().describe("Category UUID"),
        name: z.string().min(1).max(50).optional().describe("New name"),
        color: z
          .string()
          .regex(HEX_COLOR_REGEX)
          .nullable()
          .optional()
          .describe("Hex color code (#RRGGBB format, null to clear)"),
        sort_order: z.number().int().min(0).max(999999).optional().describe("Sort position"),
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
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_delete_category",
    {
      title: "Delete Category",
      description: `Delete a category permanently. Items currently assigned to this category will have their category_id set to null automatically (ON DELETE SET NULL) — they will not be deleted.

Use sparkle_list_categories to find the category UUID first.

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
        return formatToolError(error);
      }
    },
  );

  server.registerTool(
    "sparkle_reorder_categories",
    {
      title: "Reorder Categories",
      description: `Set the display order of categories by providing each category's new sort_order value.

Use sparkle_list_categories to get current IDs and order, then provide the new ordering. All categories in the list are updated in a single transaction.

Args:
  - items (array, required): Array of { id: string (UUID), sort_order: number (integer >= 0) }. Min 1, max 500 items.

Returns: Confirmation of reorder.`,
      inputSchema: {
        items: z
          .array(
            z.object({
              id: z.string().uuid().describe("Category UUID"),
              sort_order: z.number().int().min(0).max(999999).describe("New sort position"),
            }),
          )
          .min(1)
          .max(500)
          .describe("Array of { id, sort_order } pairs"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ items }) => {
      try {
        await reorderCategoriesApi(items);
        return {
          content: [
            { type: "text", text: `Categories reordered successfully (${items.length} updated).` },
          ],
        };
      } catch (error) {
        return formatToolError(error);
      }
    },
  );
}
