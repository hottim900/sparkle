import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

// Mock node:fs/promises statfs
const mockStatfs = vi.fn();
vi.mock("node:fs/promises", () => ({
  statfs: (...args: unknown[]) => mockStatfs(...args),
}));

import { checkHealth } from "../health.js";

// Helper: create a minimal in-memory SQLite DB
function createSqlite() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  return sqlite;
}

// Simulate a healthy disk with plenty of space (1 GB available)
function mockHealthyDisk() {
  mockStatfs.mockResolvedValue({
    bavail: 262144, // 1 GB / 4096
    bsize: 4096,
  });
}

// Simulate a low-disk scenario (50 MB available)
function mockLowDisk() {
  mockStatfs.mockResolvedValue({
    bavail: 12800, // 50 MB / 4096
    bsize: 4096,
  });
}

beforeEach(() => {
  mockStatfs.mockReset();
});

describe("checkHealth", () => {
  it("returns ok when DB and disk are healthy", async () => {
    const sqlite = createSqlite();
    mockHealthyDisk();

    const result = await checkHealth(sqlite, "/tmp");

    expect(result.status).toBe("ok");
    expect(result.checks.db).toBe("ok");
    expect(result.checks.disk.status).toBe("ok");
    expect(result.checks.disk.availableMb).toBe(1024);
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.uptime)).toBe(true);

    sqlite.close();
  });

  it("returns degraded with db error when DB is closed", async () => {
    const sqlite = createSqlite();
    sqlite.close();
    mockHealthyDisk();

    const result = await checkHealth(sqlite, "/tmp");

    expect(result.status).toBe("degraded");
    expect(result.checks.db).toBe("error");
    expect(result.checks.disk.status).toBe("ok");
  });

  it("returns degraded with disk warning when space is low", async () => {
    const sqlite = createSqlite();
    mockLowDisk();

    const result = await checkHealth(sqlite, "/tmp");

    expect(result.status).toBe("degraded");
    expect(result.checks.db).toBe("ok");
    expect(result.checks.disk.status).toBe("warning");
    expect(result.checks.disk.availableMb).toBe(50);

    sqlite.close();
  });

  it("returns degraded with disk warning when statfs fails", async () => {
    const sqlite = createSqlite();
    mockStatfs.mockRejectedValue(new Error("ENOENT"));

    const result = await checkHealth(sqlite, "/nonexistent");

    expect(result.status).toBe("degraded");
    expect(result.checks.disk.status).toBe("warning");
    expect(result.checks.disk.availableMb).toBe(-1);

    sqlite.close();
  });

  it("returns degraded when both DB and disk fail", async () => {
    const sqlite = createSqlite();
    sqlite.close();
    mockStatfs.mockRejectedValue(new Error("ENOENT"));

    const result = await checkHealth(sqlite, "/nonexistent");

    expect(result.status).toBe("degraded");
    expect(result.checks.db).toBe("error");
    expect(result.checks.disk.status).toBe("warning");
    expect(result.checks.disk.availableMb).toBe(-1);
  });

  it("returns disk ok at exactly 100 MB threshold", async () => {
    const sqlite = createSqlite();
    // Exactly 100 MB = 25600 blocks * 4096 bytes
    mockStatfs.mockResolvedValue({
      bavail: 25600,
      bsize: 4096,
    });

    const result = await checkHealth(sqlite, "/tmp");

    expect(result.checks.disk.status).toBe("ok");
    expect(result.checks.disk.availableMb).toBe(100);

    sqlite.close();
  });

  it("returns disk warning at 99 MB (just below threshold)", async () => {
    const sqlite = createSqlite();
    // 99 MB = 25344 blocks * 4096 bytes
    mockStatfs.mockResolvedValue({
      bavail: 25344,
      bsize: 4096,
    });

    const result = await checkHealth(sqlite, "/tmp");

    expect(result.checks.disk.status).toBe("warning");
    expect(result.checks.disk.availableMb).toBe(99);

    sqlite.close();
  });
});
