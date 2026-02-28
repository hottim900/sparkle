import { describe, it, expect } from "vitest";
import { parseCommand } from "../line.js";

describe("parseCommand", () => {
  // Help commands
  it("parses '?' as help", () => {
    expect(parseCommand("?")).toEqual({ type: "help" });
  });

  it("parses 'help' as help", () => {
    expect(parseCommand("help")).toEqual({ type: "help" });
  });

  it("parses '說明' as help", () => {
    expect(parseCommand("說明")).toEqual({ type: "help" });
  });

  // Existing query commands
  it("parses '!find keyword' as find command", () => {
    const result = parseCommand("!find Hono");
    expect(result).toEqual({ type: "find", keyword: "Hono" });
  });

  it("parses '!inbox' as fleeting command (backward compat)", () => {
    expect(parseCommand("!inbox")).toEqual({ type: "fleeting" });
  });

  it("parses '!today' as today command", () => {
    expect(parseCommand("!today")).toEqual({ type: "today" });
  });

  it("parses '!stats' as stats command", () => {
    expect(parseCommand("!stats")).toEqual({ type: "stats" });
  });

  // New commands
  it("parses '!active' as active command", () => {
    expect(parseCommand("!active")).toEqual({ type: "active" });
  });

  it("parses '!notes' as notes command", () => {
    expect(parseCommand("!notes")).toEqual({ type: "notes" });
  });

  it("parses '!todos' as todos command", () => {
    expect(parseCommand("!todos")).toEqual({ type: "todos" });
  });

  it("parses '!list 工作' as list command with tag", () => {
    expect(parseCommand("!list 工作")).toEqual({ type: "list", tag: "工作" });
  });

  it("parses '!detail 1' as detail command with index 1", () => {
    expect(parseCommand("!detail 1")).toEqual({ type: "detail", index: 1 });
  });

  it("parses '!detail 3' as detail command with index 3", () => {
    expect(parseCommand("!detail 3")).toEqual({ type: "detail", index: 3 });
  });

  it("parses '!due 1 明天' as due command", () => {
    expect(parseCommand("!due 1 明天")).toEqual({ type: "due", index: 1, dateInput: "明天" });
  });

  it("parses '!due 2 2026-03-15' as due command", () => {
    expect(parseCommand("!due 2 2026-03-15")).toEqual({
      type: "due",
      index: 2,
      dateInput: "2026-03-15",
    });
  });

  it("parses '!tag 1 工作 重要' as tag command", () => {
    expect(parseCommand("!tag 1 工作 重要")).toEqual({
      type: "tag",
      index: 1,
      tags: ["工作", "重要"],
    });
  });

  it("parses '!tag 2 個人' as tag command with single tag", () => {
    expect(parseCommand("!tag 2 個人")).toEqual({ type: "tag", index: 2, tags: ["個人"] });
  });

  // Edge cases - unknown
  it("parses '!detail' without number as unknown", () => {
    expect(parseCommand("!detail")).toEqual({ type: "unknown" });
  });

  it("parses '!due 1' without date as unknown", () => {
    expect(parseCommand("!due 1")).toEqual({ type: "unknown" });
  });

  it("parses '!tag 1' without tags as unknown", () => {
    expect(parseCommand("!tag 1")).toEqual({ type: "unknown" });
  });

  it("parses '!list' without tag as unknown", () => {
    expect(parseCommand("!list")).toEqual({ type: "unknown" });
  });

  // Save commands (existing behavior preserved)
  it("parses '!todo Buy milk' as save with type=todo", () => {
    const result = parseCommand("!todo Buy milk");
    expect(result.type).toBe("save");
    if (result.type === "save") {
      expect(result.parsed.type).toBe("todo");
      expect(result.parsed.title).toBe("Buy milk");
    }
  });

  it("parses 'Hello world' as save with type=note", () => {
    const result = parseCommand("Hello world");
    expect(result.type).toBe("save");
    if (result.type === "save") {
      expect(result.parsed.type).toBe("note");
      expect(result.parsed.title).toBe("Hello world");
    }
  });

  it("parses empty string as unknown", () => {
    expect(parseCommand("")).toEqual({ type: "unknown" });
  });

  // Status change commands (!done, !archive)
  describe("status change commands", () => {
    it("parses !done N", () => {
      expect(parseCommand("!done 3")).toEqual({ type: "done", index: 3 });
    });

    it("parses !archive N", () => {
      expect(parseCommand("!archive 2")).toEqual({ type: "archive", index: 2 });
    });

    it("rejects !done without number", () => {
      expect(parseCommand("!done")).toEqual({ type: "unknown" });
    });

    it("rejects !done with invalid number", () => {
      expect(parseCommand("!done abc")).toEqual({ type: "unknown" });
      expect(parseCommand("!done 0")).toEqual({ type: "unknown" });
      expect(parseCommand("!done -1")).toEqual({ type: "unknown" });
    });

    it("rejects !archive without number", () => {
      expect(parseCommand("!archive")).toEqual({ type: "unknown" });
    });
  });

  // Priority command
  describe("priority command", () => {
    it("parses !priority N high", () => {
      expect(parseCommand("!priority 1 high")).toEqual({
        type: "priority",
        index: 1,
        priority: "high",
      });
    });

    it("parses !priority N medium", () => {
      expect(parseCommand("!priority 2 medium")).toEqual({
        type: "priority",
        index: 2,
        priority: "medium",
      });
    });

    it("parses !priority N low", () => {
      expect(parseCommand("!priority 3 low")).toEqual({
        type: "priority",
        index: 3,
        priority: "low",
      });
    });

    it("parses !priority N none to clear", () => {
      expect(parseCommand("!priority 1 none")).toEqual({
        type: "priority",
        index: 1,
        priority: null,
      });
      expect(parseCommand("!priority 1 清除")).toEqual({
        type: "priority",
        index: 1,
        priority: null,
      });
    });

    it("rejects invalid priority level", () => {
      expect(parseCommand("!priority 1 urgent")).toEqual({ type: "unknown" });
    });

    it("rejects missing parameters", () => {
      expect(parseCommand("!priority")).toEqual({ type: "unknown" });
      expect(parseCommand("!priority 1")).toEqual({ type: "unknown" });
    });
  });

  // Untag command
  describe("untag command", () => {
    it("parses !untag N tag1", () => {
      expect(parseCommand("!untag 1 work")).toEqual({ type: "untag", index: 1, tags: ["work"] });
    });

    it("parses !untag N with multiple tags", () => {
      expect(parseCommand("!untag 2 work urgent")).toEqual({
        type: "untag",
        index: 2,
        tags: ["work", "urgent"],
      });
    });

    it("rejects missing parameters", () => {
      expect(parseCommand("!untag")).toEqual({ type: "unknown" });
      expect(parseCommand("!untag 1")).toEqual({ type: "unknown" });
    });
  });

  // Track command
  describe("track command", () => {
    it("parses '!track 1' as track command with index 1", () => {
      expect(parseCommand("!track 1")).toEqual({ type: "track", index: 1 });
    });

    it("parses '!track 1 後天' as track command with dateInput", () => {
      expect(parseCommand("!track 1 後天")).toEqual({ type: "track", index: 1, dateInput: "後天" });
    });

    it("parses '!track 2 2026-03-15' as track with date string", () => {
      expect(parseCommand("!track 2 2026-03-15")).toEqual({
        type: "track",
        index: 2,
        dateInput: "2026-03-15",
      });
    });

    it("parses '!track' without number as unknown", () => {
      expect(parseCommand("!track")).toEqual({ type: "unknown" });
    });

    it("parses '!track abc' as unknown", () => {
      expect(parseCommand("!track abc")).toEqual({ type: "unknown" });
    });

    it("parses '!track 0' as unknown", () => {
      expect(parseCommand("!track 0")).toEqual({ type: "unknown" });
    });
  });

  // Scratch commands
  describe("scratch commands", () => {
    it("parses !scratch", () => {
      expect(parseCommand("!scratch")).toEqual({ type: "scratch" });
    });
    it("parses !s as scratch alias", () => {
      expect(parseCommand("!s")).toEqual({ type: "scratch" });
    });
    it("parses !tmp with content", () => {
      const result = parseCommand("!tmp some temporary note");
      expect(result).toEqual({
        type: "save",
        parsed: expect.objectContaining({
          title: "some temporary note",
          type: "scratch",
        }),
      });
    });
    it("parses !tmp without content as unknown", () => {
      expect(parseCommand("!tmp")).toEqual({ type: "unknown" });
    });
    it("parses !tmp with only spaces as unknown", () => {
      expect(parseCommand("!tmp   ")).toEqual({ type: "unknown" });
    });
    it("parses !delete N", () => {
      expect(parseCommand("!delete 3")).toEqual({ type: "delete", index: 3 });
    });
    it("parses !delete without number as unknown", () => {
      expect(parseCommand("!delete")).toEqual({ type: "unknown" });
    });
    it("parses !delete with invalid number as unknown", () => {
      expect(parseCommand("!delete abc")).toEqual({ type: "unknown" });
      expect(parseCommand("!delete 0")).toEqual({ type: "unknown" });
      expect(parseCommand("!delete -1")).toEqual({ type: "unknown" });
    });
    it("parses !upgrade N", () => {
      expect(parseCommand("!upgrade 2")).toEqual({ type: "upgrade", index: 2 });
    });
    it("parses !upgrade without number as unknown", () => {
      expect(parseCommand("!upgrade")).toEqual({ type: "unknown" });
    });
    it("parses !upgrade with invalid number as unknown", () => {
      expect(parseCommand("!upgrade abc")).toEqual({ type: "unknown" });
      expect(parseCommand("!upgrade 0")).toEqual({ type: "unknown" });
    });
  });

  // Zettelkasten commands
  describe("new Zettelkasten commands", () => {
    it("parses '!fleeting' as fleeting query", () => {
      expect(parseCommand("!fleeting")).toEqual({ type: "fleeting" });
    });

    it("parses '!developing' as developing query", () => {
      expect(parseCommand("!developing")).toEqual({ type: "developing" });
    });

    it("parses '!permanent' as permanent query", () => {
      expect(parseCommand("!permanent")).toEqual({ type: "permanent" });
    });

    it("parses '!develop 1' as develop command", () => {
      expect(parseCommand("!develop 1")).toEqual({ type: "develop", index: 1 });
    });

    it("parses '!mature 2' as mature command", () => {
      expect(parseCommand("!mature 2")).toEqual({ type: "mature", index: 2 });
    });

    it("parses '!export 3' as export command", () => {
      expect(parseCommand("!export 3")).toEqual({ type: "export", index: 3 });
    });

    it("rejects '!develop' without number as unknown", () => {
      expect(parseCommand("!develop")).toEqual({ type: "unknown" });
    });

    it("rejects '!mature' without number as unknown", () => {
      expect(parseCommand("!mature")).toEqual({ type: "unknown" });
    });

    it("rejects '!export' without number as unknown", () => {
      expect(parseCommand("!export")).toEqual({ type: "unknown" });
    });
  });
});
