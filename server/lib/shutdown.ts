import type { Server } from "node:http";
import type Database from "better-sqlite3";
import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";

const DEFAULT_TIMEOUT_MS = 25_000; // 25s, leaving 5s buffer for systemd's 30s

export function setupGracefulShutdown(
  server: Server,
  sqliteDb: Database.Database,
  options?: { timeoutMs?: number },
): void {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) {
      logger.info("Shutdown already in progress, ignoring %s", signal);
      return;
    }
    shuttingDown = true;
    logger.info("%s received, starting graceful shutdown...", signal);

    const forceTimer = setTimeout(() => {
      logger.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, timeoutMs);
    // Allow process to exit even if timer is still pending
    forceTimer.unref();

    server.close(async () => {
      logger.info("HTTP server closed");

      try {
        await Sentry.close(2000);
        logger.info("Sentry flushed");
      } catch (err) {
        logger.warn({ err }, "Sentry flush failed");
      }

      try {
        sqliteDb.pragma("wal_checkpoint(TRUNCATE)");
        logger.info("WAL checkpoint completed");
      } catch (err) {
        logger.error({ err }, "WAL checkpoint failed");
      }

      try {
        sqliteDb.close();
        logger.info("Database connection closed");
      } catch (err) {
        logger.error({ err }, "Database close failed");
      }

      clearTimeout(forceTimer);
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
