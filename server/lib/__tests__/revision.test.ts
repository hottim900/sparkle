import { describe, it, expect } from "vitest";
import { computeRevision, REVISION_REGEX, RevisionMismatchError } from "../revision.js";

describe("computeRevision", () => {
  it("returns 64-character lowercase hex for ASCII content", () => {
    const rev = computeRevision("hello world");
    expect(rev).toMatch(REVISION_REGEX);
    expect(rev).toBe("b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("returns the empty-string revision for null and undefined", () => {
    const emptyHex = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(computeRevision("")).toBe(emptyHex);
    expect(computeRevision(null)).toBe(emptyHex);
    expect(computeRevision(undefined)).toBe(emptyHex);
  });

  it("is stable across CJK content", () => {
    expect(computeRevision("你好世界")).toBe(computeRevision("你好世界"));
    expect(computeRevision("你好世界")).not.toBe(computeRevision("你好"));
  });

  it("matches sha256 of UTF-8 encoded bytes for surrogate pairs", () => {
    // U+1F600 grinning face — a high/low surrogate pair in JS strings.
    // Same input must hash identically across the MCP edit_note revision
    // module and this server-side counterpart.
    const emoji = "😀 hello";
    expect(computeRevision(emoji)).toBe(
      "c5c5f9a15a5c7edc754d7919e4819891eb381bb92e1223c22719a5a224254d35",
    );
    expect(computeRevision(emoji)).toMatch(REVISION_REGEX);
  });
});

describe("RevisionMismatchError", () => {
  it("carries id, expected, actual, currentContent and a stable code", () => {
    const e = new RevisionMismatchError("abc-123", "a".repeat(64), "b".repeat(64), "body text");
    expect(e.code).toBe("REVISION_MISMATCH");
    expect(e.itemId).toBe("abc-123");
    expect(e.expected).toBe("a".repeat(64));
    expect(e.actual).toBe("b".repeat(64));
    expect(e.currentContent).toBe("body text");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("RevisionMismatchError");
  });
});
