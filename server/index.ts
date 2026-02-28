import "./instrument.js";
import * as Sentry from "@sentry/node";
import { serve, getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "./lib/logger.js";
import { requestLogger } from "./middleware/logger.js";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:https";
import { authMiddleware } from "./middleware/auth.js";
import {
  apiRateLimiter,
  authFailRateLimiter,
  webhookRateLimiter,
} from "./middleware/rate-limit.js";
import { setupGracefulShutdown } from "./lib/shutdown.js";
import { itemsRouter } from "./routes/items.js";
import { searchRouter } from "./routes/search.js";
import { statsRouter } from "./routes/stats.js";
import { webhookRouter } from "./routes/webhook.js";
import { settingsRouter } from "./routes/settings.js";
import { sharesRouter } from "./routes/shares.js";
import { publicRouter } from "./routes/public.js";
import { db, sqlite, DB_PATH } from "./db/index.js";
import { items } from "./db/schema.js";
import { checkHealth } from "./lib/health.js";
import { dirname } from "node:path";
import { eq } from "drizzle-orm";
import { getAllTags } from "./lib/items.js";
import { getObsidianSettings } from "./lib/settings.js";
import { z, ZodError } from "zod";
import { statusEnum } from "./schemas/items.js";

// --- Startup validation ---
function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1);
  const len = s.length;
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const authToken = process.env.AUTH_TOKEN;
if (!authToken) {
  logger.fatal(
    "AUTH_TOKEN environment variable is not set. Generate one with: openssl rand -base64 32",
  );
  process.exit(1);
}
if (authToken.length < 32) {
  logger.fatal(
    "AUTH_TOKEN is too short (%d chars, minimum 32). Generate one with: openssl rand -base64 32",
    authToken.length,
  );
  process.exit(1);
}
if (shannonEntropy(authToken) < 3.0) {
  logger.fatal(
    "AUTH_TOKEN has insufficient entropy (too predictable). Generate one with: openssl rand -base64 32",
  );
  process.exit(1);
}

// LINE secrets validation (non-blocking)
const lineSecret = process.env.LINE_CHANNEL_SECRET;
const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (lineSecret || lineToken) {
  if (!lineSecret) {
    logger.warn(
      "LINE_CHANNEL_SECRET is not set (LINE_CHANNEL_ACCESS_TOKEN is set). LINE Bot will not work.",
    );
  } else if (lineSecret.length < 20) {
    logger.warn(
      "LINE_CHANNEL_SECRET looks too short (%d chars). Verify your LINE configuration.",
      lineSecret.length,
    );
  }
  if (!lineToken) {
    logger.warn(
      "LINE_CHANNEL_ACCESS_TOKEN is not set (LINE_CHANNEL_SECRET is set). LINE Bot will not work.",
    );
  } else if (lineToken.length < 50) {
    logger.warn(
      "LINE_CHANNEL_ACCESS_TOKEN looks too short (%d chars). Verify your LINE configuration.",
      lineToken.length,
    );
  }
}

const app = new Hono();

app.use("*", requestLogger);
app.use("*", compress());
app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Vary")) {
    c.res.headers.set("Vary", "Accept-Encoding");
  }
});

// Content-Security-Policy
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  );
});

// Rate limiting — webhook has its own limiter, applied before auth (webhook skips auth)
app.use("/api/webhook/*", webhookRateLimiter);

// API rate limits — skip webhook paths (already handled above)
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/webhook/")) return next();
  return apiRateLimiter(c, next);
});
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/webhook/")) return next();
  return authFailRateLimiter(c, next);
});

// Rate limit for public share pages
app.use("/s/*", apiRateLimiter);

// Body size limit — 1MB for all API POST/PUT requests (after rate limiter, before auth)
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 1024 * 1024, // 1MB
    onError: (c) => {
      return c.json({ error: "Request body too large (max 1MB)" }, 413);
    },
  }),
);

// Auth on all /api routes
app.use("/api/*", authMiddleware);

// Mount API routes
app.route("/api/items", itemsRouter);
app.route("/api/search", searchRouter);
app.route("/api/stats", statsRouter);
app.route("/api/webhook", webhookRouter);
app.route("/api/settings", settingsRouter);
app.route("/api", sharesRouter);

// Health check endpoint (unauthenticated — skipped in auth middleware)
app.get("/api/health", async (c) => {
  const result = await checkHealth(sqlite, dirname(DB_PATH));
  return c.json(result, result.status === "ok" ? 200 : 503);
});

// Tags endpoint (separate from items CRUD to avoid /:id conflict)
app.get("/api/tags", (c) => {
  const tags = getAllTags(sqlite);
  return c.json({ tags });
});

// Config endpoint — tells frontend whether Obsidian export is available
app.get("/api/config", (c) => {
  const obsidian = getObsidianSettings(sqlite);
  return c.json({
    obsidian_export_enabled: obsidian.obsidian_enabled && !!obsidian.obsidian_vault_path,
  });
});

// Export all items (new field names)
app.get("/api/export", (c) => {
  const allItems = db.select().from(items).all();
  return c.json({
    version: 2,
    exported_at: new Date().toISOString(),
    items: allItems,
  });
});

// Import items (upsert) — only accepts new field names/status values
const importItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["note", "todo"]).default("note"),
  title: z.string().min(1).max(500),
  content: z.string().default(""),
  status: statusEnum.default("fleeting"),
  priority: z.enum(["low", "medium", "high"]).nullable().default(null),
  due: z.string().nullable().default(null),
  tags: z.string().default("[]"),
  origin: z.string().default(""),
  source: z.string().nullable().default(null),
  aliases: z.string().default("[]"),
  linked_note_id: z.string().nullable().default(null),
  created: z.string().min(1),
  modified: z.string().min(1),
});

const importSchema = z.object({
  items: z.array(importItemSchema),
});

// Detect old format fields and reject with helpful message
const OLD_FIELD_NAMES = ["due_date", "created_at", "updated_at"] as const;

app.post("/api/import", async (c) => {
  try {
    const body = await c.req.json();

    // Check for old format fields
    if (body.items && Array.isArray(body.items) && body.items.length > 0) {
      const sample = body.items[0];
      for (const oldField of OLD_FIELD_NAMES) {
        if (oldField in sample) {
          return c.json(
            { error: "Unrecognized field names — please re-export from current version" },
            400,
          );
        }
      }
      // Also check for old status values
      if (sample.status === "inbox") {
        return c.json(
          { error: "Unrecognized field names — please re-export from current version" },
          400,
        );
      }
    }

    const { items: importItems } = importSchema.parse(body);

    let imported = 0;
    let updated = 0;

    for (const item of importItems) {
      const existing = db.select().from(items).where(eq(items.id, item.id)).get();

      if (existing) {
        db.update(items)
          .set({
            type: item.type,
            title: item.title,
            content: item.content,
            status: item.status,
            priority: item.priority,
            due: item.due,
            tags: item.tags,
            origin: item.origin,
            source: item.source,
            aliases: item.aliases,
            linked_note_id: item.linked_note_id,
            created: item.created,
            modified: item.modified,
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
      return c.json({ error: e.errors[0]?.message ?? "Validation error" }, 400);
    }
    throw e;
  }
});

// Public routes (no auth required — bypass handled in auth middleware)
app.route("/", publicRouter);

// Sentry error handler (captures exceptions, skips 3xx/4xx)
Sentry.setupHonoErrorHandler(app);

// Global error handler
app.onError((err, c) => {
  logger.error({ err }, "Unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});

// In production, serve Vite build output
if (process.env.NODE_ENV === "production") {
  // Cache-Control headers for static assets
  app.use("/*", async (c, next) => {
    await next();
    const path = c.req.path;
    if (path.startsWith("/assets/")) {
      // Vite hashed filenames — safe to cache forever
      c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    } else if (path === "/sw.js" || path === "/manifest.webmanifest") {
      // Service worker and manifest must always be fresh
      c.res.headers.set("Cache-Control", "no-cache");
    }
  });
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";

let httpServer;

// TLS is optional. When running behind a Cloudflare Tunnel, plain HTTP is
// recommended (both processes share localhost, so TLS adds overhead with no
// security benefit). Set TLS_CERT and TLS_KEY in .env only for direct LAN
// access or non-tunnel deployments.
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  const cert = readFileSync(process.env.TLS_CERT);
  const key = readFileSync(process.env.TLS_KEY);
  httpServer = createServer({ cert, key }, getRequestListener(app.fetch));
  httpServer.listen(port, host, () => {
    logger.info(`Server running on https://${host}:${port}`);
  });
} else {
  httpServer = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    logger.info(`Server running on http://${info.address}:${info.port}`);
  });
}

setupGracefulShutdown(httpServer as Server, sqlite);

export default app;
