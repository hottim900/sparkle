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

  it("parses '!inbox' as inbox command", () => {
    expect(parseCommand("!inbox")).toEqual({ type: "inbox" });
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
    expect(parseCommand("!due 2 2026-03-15")).toEqual({ type: "due", index: 2, dateInput: "2026-03-15" });
  });

  it("parses '!tag 1 工作 重要' as tag command", () => {
    expect(parseCommand("!tag 1 工作 重要")).toEqual({ type: "tag", index: 1, tags: ["工作", "重要"] });
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
});
