import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupGracefulShutdown } from "../shutdown.js";
import type { Server } from "node:http";
import type Database from "better-sqlite3";

function createMockServer() {
  const mock = {
    close: vi.fn<(cb?: () => void) => Server>(),
  };
  // By default, invoke callback immediately (successful close)
  mock.close.mockImplementation(((cb?: () => void) => {
    if (cb) cb();
    return mock as unknown as Server;
  }) as (cb?: () => void) => Server);
  return mock as unknown as Server;
}

function createMockSqlite() {
  return {
    pragma: vi.fn(),
    close: vi.fn(),
  } as unknown as Database.Database;
}

describe("setupGracefulShutdown", () => {
  let signalHandlers: Map<string, (() => void)[]>;
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    signalHandlers = new Map();

    processOnSpy = vi.spyOn(process, "on").mockImplementation(((
      event: string,
      handler: () => void,
    ) => {
      if (!signalHandlers.has(event)) signalHandlers.set(event, []);
      signalHandlers.get(event)!.push(handler);
      return process;
    }) as typeof process.on);

    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {}) as unknown as (code?: number) => never);

    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function emitSignal(signal: string) {
    const handlers = signalHandlers.get(signal) || [];
    for (const handler of handlers) handler();
  }

  it("registers SIGTERM and SIGINT handlers", () => {
    const server = createMockServer();
    const sqlite = createMockSqlite();
    setupGracefulShutdown(server, sqlite);

    expect(signalHandlers.has("SIGTERM")).toBe(true);
    expect(signalHandlers.has("SIGINT")).toBe(true);
  });

  it("closes server, checkpoints WAL, closes DB, and exits on SIGTERM", () => {
    const server = createMockServer();
    const sqlite = createMockSqlite();
    setupGracefulShutdown(server, sqlite);

    emitSignal("SIGTERM");

    expect(server.close).toHaveBeenCalledOnce();
    expect(sqlite.pragma).toHaveBeenCalledWith("wal_checkpoint(TRUNCATE)");
    expect(sqlite.close).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("closes server, checkpoints WAL, closes DB, and exits on SIGINT", () => {
    const server = createMockServer();
    const sqlite = createMockSqlite();
    setupGracefulShutdown(server, sqlite);

    emitSignal("SIGINT");

    expect(server.close).toHaveBeenCalledOnce();
    expect(sqlite.pragma).toHaveBeenCalledWith("wal_checkpoint(TRUNCATE)");
    expect(sqlite.close).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("prevents duplicate shutdown on repeated signals", () => {
    const server = createMockServer();
    const sqlite = createMockSqlite();
    setupGracefulShutdown(server, sqlite);

    emitSignal("SIGTERM");
    emitSignal("SIGTERM");
    emitSignal("SIGINT");

    expect(server.close).toHaveBeenCalledOnce();
    expect(sqlite.close).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledTimes(1);
  });

  it("force exits after timeout when server.close hangs", () => {
    const server = createMockServer();
    // Override close to never invoke callback (simulating a hang)
    (server.close as ReturnType<typeof vi.fn>).mockImplementation(() => server);
    const sqlite = createMockSqlite();
    setupGracefulShutdown(server, sqlite, { timeoutMs: 5000 });

    emitSignal("SIGTERM");

    // server.close was called but callback never fires
    expect(server.close).toHaveBeenCalledOnce();
    expect(processExitSpy).not.toHaveBeenCalled();

    // Advance past timeout
    vi.advanceTimersByTime(5000);

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Graceful shutdown timed out, forcing exit",
    );
  });

  it("still closes DB and exits even if WAL checkpoint fails", () => {
    const server = createMockServer();
    const sqlite = createMockSqlite();
    (sqlite.pragma as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("disk I/O error");
    });
    setupGracefulShutdown(server, sqlite);

    emitSignal("SIGTERM");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "WAL checkpoint failed:",
      expect.any(Error),
    );
    expect(sqlite.close).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("still exits even if DB close fails", () => {
    const server = createMockServer();
    const sqlite = createMockSqlite();
    (sqlite.close as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("already closed");
    });
    setupGracefulShutdown(server, sqlite);

    emitSignal("SIGTERM");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Database close failed:",
      expect.any(Error),
    );
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });
});
