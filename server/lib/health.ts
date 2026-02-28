import { statfs } from "node:fs/promises";
import type Database from "better-sqlite3";

const DISK_WARNING_THRESHOLD_MB = 100;

export interface HealthCheckResult {
  status: "ok" | "degraded";
  checks: {
    db: "ok" | "error";
    disk: {
      status: "ok" | "warning";
      availableMb: number;
    };
  };
  uptime: number;
}

export async function checkHealth(
  sqlite: Database.Database,
  dataDir: string,
): Promise<HealthCheckResult> {
  // DB check: lightweight SELECT 1
  let dbStatus: "ok" | "error" = "ok";
  try {
    sqlite.prepare("SELECT 1").get();
  } catch {
    dbStatus = "error";
  }

  // Disk check: available space on the partition containing dataDir
  let diskStatus: "ok" | "warning" = "ok";
  let availableMb = 0;
  try {
    const stats = await statfs(dataDir);
    availableMb = Math.floor((stats.bavail * stats.bsize) / (1024 * 1024));
    if (availableMb < DISK_WARNING_THRESHOLD_MB) {
      diskStatus = "warning";
    }
  } catch {
    diskStatus = "warning";
    availableMb = -1;
  }

  const degraded = dbStatus === "error" || diskStatus === "warning";

  return {
    status: degraded ? "degraded" : "ok",
    checks: {
      db: dbStatus,
      disk: { status: diskStatus, availableMb },
    },
    uptime: Math.floor(process.uptime()),
  };
}
