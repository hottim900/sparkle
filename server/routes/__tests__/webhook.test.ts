import { describe, it, expect } from "vitest";
import { parseLineMessage } from "../../lib/line.js";

describe("parseLineMessage", () => {
  it("parses simple text as note title", () => {
    const result = parseLineMessage("Hello world");
    expect(result.title).toBe("Hello world");
    expect(result.type).toBe("note");
    expect(result.priority).toBeNull();
    expect(result.content).toBe("");
  });

  it("parses multiline text: first line as title, rest as content", () => {
    const result = parseLineMessage("First line\nSecond line\nThird line");
    expect(result.title).toBe("First line");
    expect(result.content).toBe("Second line\nThird line");
  });

  it("parses !todo prefix to set type=todo", () => {
    const result = parseLineMessage("!todo Buy groceries");
    expect(result.title).toBe("Buy groceries");
    expect(result.type).toBe("todo");
  });

  it("parses !high prefix to set priority=high", () => {
    const result = parseLineMessage("!high Urgent task");
    expect(result.title).toBe("Urgent task");
    expect(result.priority).toBe("high");
    expect(result.type).toBe("note");
  });

  it("parses combined !todo !high prefixes", () => {
    const result = parseLineMessage("!todo !high Important task");
    expect(result.title).toBe("Important task");
    expect(result.type).toBe("todo");
    expect(result.priority).toBe("high");
  });

  it("handles !high !todo order too", () => {
    const result = parseLineMessage("!high !todo Another task");
    expect(result.title).toBe("Another task");
    expect(result.type).toBe("todo");
    expect(result.priority).toBe("high");
  });

  it("trims whitespace", () => {
    const result = parseLineMessage("  Hello world  ");
    expect(result.title).toBe("Hello world");
  });

  it("returns empty title for blank message", () => {
    const result = parseLineMessage("");
    expect(result.title).toBe("");
    expect(result.content).toBe("");
    expect(result.type).toBe("note");
    expect(result.priority).toBeNull();
  });

  it("sets source to 'LINE 轉傳' when isForwarded is true", () => {
    const result = parseLineMessage("Hello", true);
    expect(result.source).toBe("LINE 轉傳");
  });

  it("sets source to 'LINE' by default", () => {
    const result = parseLineMessage("Hello");
    expect(result.source).toBe("LINE");
  });
});
