import { describe, it, expect } from "vitest";
import { parseLineMessage, parseCommand } from "../line";

describe("!private / !p prefix", () => {
  it("parses !private as private note", () => {
    const r = parseLineMessage("!private 敏感想法");
    expect(r.is_private).toBe(true);
    expect(r.title).toBe("敏感想法");
    expect(r.type).toBe("note");
  });

  it("parses !p with space as private note", () => {
    const r = parseLineMessage("!p 敏感想法");
    expect(r.is_private).toBe(true);
    expect(r.title).toBe("敏感想法");
  });

  it("does not match !priority as !p", () => {
    const r = parseLineMessage("!priority test");
    expect(r.is_private).toBe(false);
  });

  it("combines !todo !p", () => {
    const r = parseLineMessage("!todo !p 去看醫生");
    expect(r.is_private).toBe(true);
    expect(r.type).toBe("todo");
    expect(r.title).toBe("去看醫生");
  });

  it("combines !p !todo !high", () => {
    const r = parseLineMessage("!p !todo !high 緊急私事");
    expect(r.is_private).toBe(true);
    expect(r.type).toBe("todo");
    expect(r.priority).toBe("high");
    expect(r.title).toBe("緊急私事");
  });

  it("standalone !p with no text", () => {
    const r = parseLineMessage("!p");
    expect(r.is_private).toBe(true);
    expect(r.title).toBe("");
  });
});

describe("parseCommand routes !private correctly", () => {
  it("parseCommand('!private 敏感想法') returns save command", () => {
    const cmd = parseCommand("!private 敏感想法");
    expect(cmd.type).toBe("save");
    if (cmd.type === "save") {
      expect(cmd.parsed.is_private).toBe(true);
    }
  });

  it("parseCommand('!p 敏感想法') returns save command", () => {
    const cmd = parseCommand("!p 敏感想法");
    expect(cmd.type).toBe("save");
  });

  it("parseCommand('!priority 1 high') does NOT match !p", () => {
    const cmd = parseCommand("!priority 1 high");
    expect(cmd.type).toBe("priority");
  });
});
