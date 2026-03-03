import { Hono } from "hono";
import { db } from "../db/index.js";
import {
  createCategory,
  listCategories,
  updateCategory,
  deleteCategory,
  reorderCategories,
} from "../lib/categories.js";
import {
  createCategorySchema,
  updateCategorySchema,
  reorderCategoriesSchema,
} from "../schemas/categories.js";
import { ZodError } from "zod";

const categoriesRouter = new Hono();

// List all categories
categoriesRouter.get("/", (c) => {
  const result = listCategories(db);
  return c.json({ categories: result });
});

// Create category
categoriesRouter.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const input = createCategorySchema.parse(body);
    const category = createCategory(db, input);
    return c.json(category, 201);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    if (e instanceof Error && e.message.includes("UNIQUE constraint")) {
      return c.json({ error: "Category name already exists" }, 409);
    }
    throw e;
  }
});

// Reorder categories (MUST be before /:id to avoid matching "reorder" as id)
categoriesRouter.patch("/reorder", async (c) => {
  try {
    const body = await c.req.json();
    const { items } = reorderCategoriesSchema.parse(body);
    reorderCategories(db, items);
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Update category
categoriesRouter.patch("/:id", async (c) => {
  try {
    const body = await c.req.json();
    const input = updateCategorySchema.parse(body);
    const category = updateCategory(db, c.req.param("id"), input);
    if (!category) {
      return c.json({ error: "Category not found" }, 404);
    }
    return c.json(category);
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
    }
    if (e instanceof Error && e.message.includes("UNIQUE constraint")) {
      return c.json({ error: "Category name already exists" }, 409);
    }
    throw e;
  }
});

// Delete category
categoriesRouter.delete("/:id", (c) => {
  const deleted = deleteCategory(db, c.req.param("id"));
  if (!deleted) {
    return c.json({ error: "Category not found" }, 404);
  }
  return c.json({ ok: true });
});

export { categoriesRouter };
