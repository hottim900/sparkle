import "./instrument.js";
import * as Sentry from "@sentry/node";
import { serve, getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { logger } from "./lib/logger.js";
import { requestLogger } from "./middleware/logger.js";
import { bodyLimit } from "hono/body-limit";
import { compress } from "hono/compress";
import { randomBytes } from "node:crypto";
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
import { categoriesRouter } from "./routes/categories.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { vaultRouter } from "./routes/vault.js";
import { publicRouter } from "./routes/public.js";
import { db, sqlite, DB_PATH } from "./db/index.js";
import { itemsActive, itemsVault, categories } from "./db/schema.js";
import { checkHealth } from "./lib/health.js";
import { dirname } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import { getAllTags } from "./lib/items.js";
import { getObsidianSettings } from "./lib/settings.js";
import { ZodError } from "zod";
import { importSchema } from "./schemas/items.js";
import { clearExpiredSessions } from "./lib/line-session.js";
import { privateRouter } from "./routes/private.js";
import { privateTokenMiddleware } from "./middleware/private-token.js";
import { clearExpiredPrivateSessions } from "./lib/private-session.js";
import { dailyNoteRouter } from "./routes/daily-note.js";
import { lineBriefRouter } from "./routes/line-brief.js";
import { checkAndGenerateDailyNote } from "./lib/daily-note-scheduler.js";
import { checkAndSendLineBrief } from "./lib/line-brief-scheduler.js";
import { startVaultScanner } from "./lib/vault-scanner.js";

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
  if (!process.env.LINE_ALLOWED_USER_IDS) {
    logger.warn("LINE_ALLOWED_USER_IDS is not set — LINE bot accepts messages from any user");
  }
}

import type { AppEnv } from "./types.js";

const app = new Hono<AppEnv>();

app.use("*", requestLogger);
// Marker header for SW to distinguish Sparkle responses from CF Access pages
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Sparkle", "1");
});
// Security hardening headers (defense-in-depth alongside Cloudflare)
app.use("*", async (c, next) => {
  await next();
  c.res.headers.set("X-Content-Type-Options", "nosniff");
  c.res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  c.res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // HSTS only in production — avoid locking dev/test environments to HTTPS
  if (process.env.NODE_ENV === "production") {
    c.res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
});
app.use("*", compress());
app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Vary")) {
    c.res.headers.set("Vary", "Accept-Encoding");
  }
});

// Content-Security-Policy
// Public share pages (/s/*) use nonce-based script-src instead of unsafe-inline
app.use("*", async (c, next) => {
  // Generate nonce before route handler so it's available via c.get("cspNonce")
  let scriptSrc = "script-src 'self'";
  if (c.req.path.startsWith("/s/")) {
    try {
      const nonce = randomBytes(16).toString("base64");
      c.set("cspNonce", nonce);
      scriptSrc = `script-src 'self' 'nonce-${nonce}'`;
    } catch {
      // Fallback: if nonce generation fails, allow inline scripts rather than breaking the page
      scriptSrc = "script-src 'self' 'unsafe-inline'";
    }
  }
  await next();
  c.res.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  );
});

// Prevent browser heuristic caching of API responses. Routes that need
// browser-side caching (e.g. /api/vault/by-sparkle-id which sets `private,
// max-age=60`) opt in by setting Cache-Control before the response returns.
app.use("/api/*", async (c, next) => {
  await next();
  if (!c.res.headers.get("Cache-Control")) {
    c.res.headers.set("Cache-Control", "no-store");
  }
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

// Private token middleware — must be registered BEFORE app.route() for Hono middleware to apply
app.use("/api/private/items", privateTokenMiddleware);
app.use("/api/private/items/*", privateTokenMiddleware);
app.use("/api/private/search", privateTokenMiddleware);
app.use("/api/private/tags", privateTokenMiddleware);
app.use("/api/private/pin", privateTokenMiddleware);
app.use("/api/private/lock", privateTokenMiddleware);

// Mount API routes
app.route("/api/private", privateRouter);
app.route("/api/items", itemsRouter);
app.route("/api/search", searchRouter);
app.route("/api/stats", statsRouter);
app.route("/api/webhook", webhookRouter);
app.route("/api/settings", settingsRouter);
app.route("/api/categories", categoriesRouter);
app.route("/api/dashboard", dashboardRouter);
app.route("/api/daily-note", dailyNoteRouter);
app.route("/api/line-brief", lineBriefRouter);
app.route("/api/vault", vaultRouter);
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

// Export all items (v1.4.0: UNION of items_active + items_vault with status='exported'
// synthesized for vault rows, preserving export round-trip compatibility).
app.get("/api/export", (c) => {
  const EXPORT_LIMIT = 50000;
  const activeRows = db
    .select()
    .from(itemsActive)
    .where(eq(itemsActive.is_private, 0))
    .limit(EXPORT_LIMIT)
    .all();
  const remaining = Math.max(0, EXPORT_LIMIT - activeRows.length);
  const vaultRows =
    remaining > 0
      ? db.select().from(itemsVault).where(eq(itemsVault.is_private, 0)).limit(remaining).all()
      : [];
  const synthesized = vaultRows.map((r) => ({
    id: r.id,
    type: "note" as const,
    title: r.title,
    content: r.content_snippet,
    status: "exported" as const,
    priority: null,
    due: null,
    tags: r.tags,
    origin: r.origin,
    source: r.source,
    aliases: r.aliases,
    linked_note_id: null,
    category_id: r.category_id,
    viewed_at: null,
    is_private: r.is_private,
    paused: 0,
    paused_at: null,
    paused_context: null,
    created: r.created,
    modified: r.exported_at,
  }));
  const allItems = [...activeRows, ...synthesized];
  const activeTotal =
    db
      .select({ count: sql<number>`count(*)` })
      .from(itemsActive)
      .where(eq(itemsActive.is_private, 0))
      .get()?.count ?? 0;
  const vaultTotal =
    db
      .select({ count: sql<number>`count(*)` })
      .from(itemsVault)
      .where(eq(itemsVault.is_private, 0))
      .get()?.count ?? 0;
  const totalCount = activeTotal + vaultTotal;
  return c.json({
    version: 2,
    exported_at: new Date().toISOString(),
    items: allItems,
    total: totalCount,
    truncated: allItems.length >= EXPORT_LIMIT,
  });
});

// Import items (upsert) — schema defined in schemas/items.ts

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
    let skipped = 0;
    const warnings: string[] = [];

    // Bulk pre-fetch valid FK references to avoid N+1 queries
    const referencedCategoryIds = [
      ...new Set(importItems.map((i) => i.category_id).filter(Boolean)),
    ] as string[];
    const validCategoryIds = new Set(
      referencedCategoryIds.length > 0
        ? db
            .select({ id: categories.id })
            .from(categories)
            .where(inArray(categories.id, referencedCategoryIds))
            .all()
            .map((r) => r.id)
        : [],
    );

    const referencedLinkedIds = [
      ...new Set(importItems.map((i) => i.linked_note_id).filter(Boolean)),
    ] as string[];
    const existingLinkedIds = new Set(
      referencedLinkedIds.length > 0
        ? db
            .select({ id: itemsActive.id })
            .from(itemsActive)
            .where(inArray(itemsActive.id, referencedLinkedIds))
            .all()
            .map((r) => r.id)
        : [],
    );

    // Track IDs that are successfully processed (not skipped) for self-references
    const processedIds = new Set<string>();

    // Wrap entire import in a transaction for atomicity
    const txResult = sqlite.transaction(() => {
      for (const item of importItems) {
        // Validate linked_note_id FK reference
        if (item.linked_note_id) {
          const linkedExists =
            processedIds.has(item.linked_note_id) || existingLinkedIds.has(item.linked_note_id);
          if (!linkedExists) {
            logger.warn(
              { itemId: item.id, linked_note_id: item.linked_note_id },
              "Import: linked_note_id references non-existent item, skipping",
            );
            warnings.push(
              `Item ${item.id}: linked_note_id "${item.linked_note_id}" not found, skipped`,
            );
            skipped++;
            continue;
          }
        }

        // Validate category_id FK reference
        if (item.category_id) {
          if (!validCategoryIds.has(item.category_id)) {
            logger.warn(
              { itemId: item.id, category_id: item.category_id },
              "Import: category_id references non-existent category, skipping",
            );
            warnings.push(`Item ${item.id}: category_id "${item.category_id}" not found, skipped`);
            skipped++;
            continue;
          }
        }

        // v1.4.0: route status='exported' rows into items_vault; others → items_active.
        if (item.status === "exported") {
          const existingVault = db
            .select()
            .from(itemsVault)
            .where(eq(itemsVault.id, item.id))
            .get();
          const snippet = (item.content ?? "").substring(0, 500);
          const exportedAt = item.modified || new Date().toISOString();
          if (existingVault) {
            if (existingVault.is_private) {
              skipped++;
              continue;
            }
            db.update(itemsVault)
              .set({
                title: item.title,
                category_id: item.category_id,
                tags: JSON.stringify(item.tags),
                aliases: JSON.stringify(item.aliases),
                source: item.source,
                origin: item.origin,
                exported_at: exportedAt,
                created: item.created,
                content_snippet: snippet,
              })
              .where(eq(itemsVault.id, item.id))
              .run();
            updated++;
          } else {
            db.insert(itemsVault)
              .values({
                id: item.id,
                title: item.title,
                category_id: item.category_id,
                tags: JSON.stringify(item.tags),
                aliases: JSON.stringify(item.aliases),
                source: item.source,
                origin: item.origin,
                exported_at: exportedAt,
                created: item.created,
                is_private: 0,
                content_snippet: snippet,
              })
              .run();
            imported++;
          }
          processedIds.add(item.id);
          continue;
        }

        const existing = db.select().from(itemsActive).where(eq(itemsActive.id, item.id)).get();

        if (existing) {
          if (existing.is_private) {
            skipped++;
            continue;
          }
          db.update(itemsActive)
            .set({
              type: item.type,
              title: item.title,
              content: item.content,
              status: item.status as "fleeting",
              priority: item.priority,
              due: item.due,
              tags: JSON.stringify(item.tags),
              origin: item.origin,
              source: item.source,
              aliases: JSON.stringify(item.aliases),
              linked_note_id: item.linked_note_id,
              category_id: item.category_id,
              created: item.created,
              modified: item.modified,
            })
            .where(eq(itemsActive.id, item.id))
            .run();
          updated++;
        } else {
          db.insert(itemsActive)
            .values({
              ...item,
              status: item.status as "fleeting",
              tags: JSON.stringify(item.tags),
              aliases: JSON.stringify(item.aliases),
              is_private: 0,
            })
            .run();
          imported++;
        }
        processedIds.add(item.id);
      }
      return { imported, updated, skipped };
    })();

    return c.json({ ...txResult, warnings: warnings.length > 0 ? warnings : undefined });
  } catch (e) {
    if (e instanceof ZodError) {
      return c.json({ error: e.issues[0]?.message ?? "Validation error" }, 400);
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

// Periodically clean up expired LINE Bot sessions (in-memory, 10-min TTL)
const sessionCleanupTimer = setInterval(clearExpiredSessions, 60_000);
sessionCleanupTimer.unref();

// Periodically clean up expired private sessions (in-memory, 30-min TTL)
const privateSessionCleanupTimer = setInterval(clearExpiredPrivateSessions, 60_000);
privateSessionCleanupTimer.unref();

// Daily note scheduler — checks every 60s if it's time to generate
const dailyNoteTimer = setInterval(() => checkAndGenerateDailyNote(sqlite), 60_000);
dailyNoteTimer.unref();

// LINE daily brief scheduler — checks every 60s if it's time to push
const lineBriefTimer = setInterval(() => checkAndSendLineBrief(sqlite), 60_000);
lineBriefTimer.unref();

// Vault scanner — indexes entire vault into vault_files table every 5 minutes.
// vault_files.sparkle_id is the source-of-truth for vault path resolution
// (post-v25 — items_vault.export_path was dropped).
startVaultScanner(db, sqlite);

export default app;
