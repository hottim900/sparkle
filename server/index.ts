import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "hono/logger";
import { readFileSync } from "node:fs";
import { createServer } from "node:https";
import { authMiddleware } from "./middleware/auth.js";
import { itemsRouter } from "./routes/items.js";
import { searchRouter } from "./routes/search.js";
import { statsRouter } from "./routes/stats.js";
import { webhookRouter } from "./routes/webhook.js";
import { db, sqlite } from "./db/index.js";
import { items } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { getAllTags } from "./lib/items.js";
import { z, ZodError } from "zod";

const app = new Hono();

app.use("*", logger());

// Auth on all /api routes
app.use("/api/*", authMiddleware);

// Mount API routes
app.route("/api/items", itemsRouter);
app.route("/api/search", searchRouter);
app.route("/api/stats", statsRouter);
app.route("/api/webhook", webhookRouter);

// Tags endpoint (separate from items CRUD to avoid /:id conflict)
app.get("/api/tags", (c) => {
  const tags = getAllTags(sqlite);
  return c.json({ tags });
});

// Export all items
app.get("/api/export", (c) => {
  const allItems = db.select().from(items).all();
  return c.json({
    version: 1,
    exported_at: new Date().toISOString(),
    items: allItems,
  });
});

// Import items (upsert)
const importItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["note", "todo"]).default("note"),
  title: z.string().min(1).max(500),
  content: z.string().default(""),
  status: z.enum(["inbox", "active", "done", "archived"]).default("inbox"),
  priority: z.enum(["low", "medium", "high"]).nullable().default(null),
  due_date: z.string().nullable().default(null),
  tags: z.string().default("[]"),
  source: z.string().default(""),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

const importSchema = z.object({
  items: z.array(importItemSchema),
});

app.post("/api/import", async (c) => {
  try {
    const body = await c.req.json();
    const { items: importItems } = importSchema.parse(body);

    let imported = 0;
    let updated = 0;

    for (const item of importItems) {
      const existing = db
        .select()
        .from(items)
        .where(eq(items.id, item.id))
        .get();

      if (existing) {
        db.update(items)
          .set({
            type: item.type,
            title: item.title,
            content: item.content,
            status: item.status,
            priority: item.priority,
            due_date: item.due_date,
            tags: item.tags,
            source: item.source,
            created_at: item.created_at,
            updated_at: item.updated_at,
          })
          .where(eq(items.id, item.id))
          .run();
        updated++;
      } else {
        db.insert(items).values(item).run();
        imported++;
      }
    }

    return c.json({ imported, updated });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json(
        { error: e.errors[0]?.message ?? "Validation error" },
        400,
      );
    }
    throw e;
  }
});

// Global error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

// In production, serve Vite build output
if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT) || 3000;

if (process.env.TLS_CERT && process.env.TLS_KEY) {
  const cert = readFileSync(process.env.TLS_CERT);
  const key = readFileSync(process.env.TLS_KEY);
  createServer({ cert, key }, app.fetch as never).listen(port, () => {
    console.log(`Server running on https://0.0.0.0:${port}`);
  });
} else {
  serve({ fetch: app.fetch, port });
  console.log(`Server running on http://localhost:${port}`);
}

export default app;
