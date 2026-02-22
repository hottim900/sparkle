import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth.js";
import { itemsRouter } from "./routes/items.js";
import { searchRouter } from "./routes/search.js";
import { sqlite } from "./db/index.js";
import { getAllTags } from "./lib/items.js";

const app = new Hono();

app.use("*", logger());

// Auth on all /api routes
app.use("/api/*", authMiddleware);

// Mount API routes
app.route("/api/items", itemsRouter);
app.route("/api/search", searchRouter);

// Tags endpoint (separate from items CRUD to avoid /:id conflict)
app.get("/api/tags", (c) => {
  const tags = getAllTags(sqlite);
  return c.json({ tags });
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

console.log(`Server running on http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port,
});

export default app;
