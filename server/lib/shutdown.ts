import type { Server } from "node:http";
import type Database from "better-sqlite3";

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
      console.log(`Shutdown already in progress, ignoring ${signal}`);
      return;
    }
    shuttingDown = true;
    console.log(`${signal} received, starting graceful shutdown...`);

    const forceTimer = setTimeout(() => {
      console.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, timeoutMs);
    // Allow process to exit even if timer is still pending
    forceTimer.unref();

    server.close(() => {
      console.log("HTTP server closed");

      try {
        sqliteDb.pragma("wal_checkpoint(TRUNCATE)");
        console.log("WAL checkpoint completed");
      } catch (err) {
        console.error("WAL checkpoint failed:", err);
      }

      try {
        sqliteDb.close();
        console.log("Database connection closed");
      } catch (err) {
        console.error("Database close failed:", err);
      }

      clearTimeout(forceTimer);
      process.exit(0);
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
