import { describe, it, expect, vi } from "vitest";
import { applyEdits, MAX_OPS, MAX_CONTENT_LENGTH, type EditOp } from "../../edit/ops.js";
import { computeRevision } from "../../edit/revision.js";

function rev(content: string): string {
  return computeRevision(content);
}

function expectSuccess<T extends ReturnType<typeof applyEdits>>(r: T) {
  if (!r.ok) throw new Error(`expected success, got: ${JSON.stringify(r.failure)}`);
  return r;
}
function expectFailure<T extends ReturnType<typeof applyEdits>>(r: T) {
  if (r.ok) throw new Error(`expected failure, got success`);
  return r;
}

describe("applyEdits — happy paths", () => {
  it("replace_block on a single paragraph note", () => {
    const content = "Old paragraph.";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_block", handle: "b0", content: "New paragraph." }],
      }),
    );
    expect(r.newContent).toBe("New paragraph.");
    expect(r.newRevision).toBe(computeRevision("New paragraph."));
    expect(r.matchTiers).toEqual([undefined]);
  });

  it("replace_lines on a multi-line note (range includes trailing \\n; caller controls separator)", () => {
    const content = "line 1\nline 2\nline 3";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_lines", start_line: 2, end_line: 2, content: "new line 2\n" }],
      }),
    );
    expect(r.newContent).toBe("line 1\nnew line 2\nline 3");
  });

  it("replace_text Tier 1 exact match", () => {
    const content = "Hello, world.";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_text", old: "world", new: "universe" }],
      }),
    );
    expect(r.newContent).toBe("Hello, universe.");
    expect(r.matchTiers).toEqual(["exact"]);
  });

  it("replace_text Tier 2 CJK punctuation drift", () => {
    const content = "段落結束：完。";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_text", old: "段落結束:完.", new: "段落完成。" }],
      }),
    );
    expect(r.newContent).toBe("段落完成。");
    expect(r.matchTiers).toEqual(["punctuation_normalized"]);
  });

  it("insert_after_line(0) prepends", () => {
    const content = "Body.";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "insert_after_line", line: 0, content: "Header.\n\n" }],
      }),
    );
    expect(r.newContent).toBe("Header.\n\nBody.");
  });

  it("insert_after_line(0) on empty content — bootstrap, no \\n prefix", () => {
    const r = expectSuccess(
      applyEdits({
        content: "",
        expectedRevision: rev(""),
        ops: [{ kind: "insert_after_line", line: 0, content: "hello" }],
      }),
    );
    expect(r.newContent).toBe("hello");
  });

  it("insert_after_line(lastLine) appends with EOF newline rule", () => {
    const content = "abc";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "insert_after_line", line: 1, content: "def" }],
      }),
    );
    expect(r.newContent).toBe("abc\ndef");
  });

  it("insert_after_line(lastLine) does NOT double-prepend \\n if user content already starts with \\n", () => {
    const content = "abc";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "insert_after_line", line: 1, content: "\ndef" }],
      }),
    );
    expect(r.newContent).toBe("abc\ndef");
  });

  it("delete_block removes a paragraph", () => {
    const content = "Para A.\n\nPara B.\n\nPara C.";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "delete_block", handle: "b1" }],
      }),
    );
    expect(r.newContent).toContain("Para A.");
    expect(r.newContent).not.toContain("Para B.");
    expect(r.newContent).toContain("Para C.");
  });

  it("delete_lines removes a range", () => {
    const content = "a\nb\nc\nd";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "delete_lines", start_line: 2, end_line: 3 }],
      }),
    );
    expect(r.newContent).toBe("a\nd");
  });

  it("multi-op atomic: two replace_blocks resolved against the same snapshot", () => {
    const content = "Para A.\n\nPara B.\n\nPara C.";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [
          { kind: "replace_block", handle: "b0", content: "First!" },
          { kind: "replace_block", handle: "b2", content: "Third!" },
        ],
      }),
    );
    expect(r.newContent).toBe("First!\n\nPara B.\n\nThird!");
  });

  it("multi-op: stacked inserts at same offset preserve source-array order in output", () => {
    const content = "abc";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [
          { kind: "insert_after_line", line: 1, content: "X" },
          { kind: "insert_after_line", line: 1, content: "Y" },
          { kind: "insert_after_line", line: 1, content: "Z" },
        ],
      }),
    );
    // First EOF insert gets \n prefix; subsequent stack verbatim.
    // Source order X→Y→Z should appear in that order in output.
    expect(r.newContent).toBe("abc\nXYZ");
  });

  it("returns fresh blocks/lines/revision for chaining", () => {
    const content = "Old.";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_block", handle: "b0", content: "New paragraph here." }],
      }),
    );
    expect(r.newRevision).toBe(computeRevision("New paragraph here."));
    expect(r.newBlocks).toHaveLength(1);
    expect(r.newBlocks[0]!.handle).toBe("b0");
    expect(r.newLines).toEqual([{ line: 1, text: "New paragraph here." }]);
  });
});

describe("applyEdits — error paths", () => {
  it("REVISION_MISMATCH returns fresh revision/lines/blocks", () => {
    const content = "Hello.";
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: "0".repeat(64),
        ops: [{ kind: "replace_block", handle: "b0", content: "New." }],
      }),
    );
    expect(r.failure.code).toBe("REVISION_MISMATCH");
    if (r.failure.code !== "REVISION_MISMATCH") return;
    expect(r.failure.current_revision).toBe(rev(content));
    expect(r.failure.lines).toEqual([{ line: 1, text: "Hello." }]);
    expect(r.failure.blocks).toHaveLength(1);
  });

  it("INVALID_HANDLE for unknown handle", () => {
    const content = "Para.";
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_block", handle: "b99", content: "X" }],
      }),
    );
    expect(r.failure.code).toBe("INVALID_HANDLE");
    if (r.failure.code !== "INVALID_HANDLE") return;
    expect(r.failure.handle).toBe("b99");
    expect(r.failure.valid_handles).toEqual(["b0"]);
  });

  it("INVALID_RANGE for out-of-bounds line numbers", () => {
    const content = "a\nb";
    const cases: Array<{ ops: EditOp[]; reasonHint: string }> = [
      { ops: [{ kind: "replace_lines", start_line: 0, end_line: 1, content: "X" }], reasonHint: "≥ 1" },
      { ops: [{ kind: "replace_lines", start_line: 3, end_line: 3, content: "X" }], reasonHint: "exceeds" },
      { ops: [{ kind: "replace_lines", start_line: 2, end_line: 1, content: "X" }], reasonHint: "<" },
    ];
    for (const c of cases) {
      const r = expectFailure(
        applyEdits({ content, expectedRevision: rev(content), ops: c.ops }),
      );
      expect(r.failure.code).toBe("INVALID_RANGE");
      if (r.failure.code !== "INVALID_RANGE") return;
      expect(r.failure.reason).toContain(c.reasonHint);
    }
  });

  it("INVALID_RANGE on empty content for any line/range op", () => {
    const r = expectFailure(
      applyEdits({
        content: "",
        expectedRevision: rev(""),
        ops: [{ kind: "replace_lines", start_line: 1, end_line: 1, content: "X" }],
      }),
    );
    expect(r.failure.code).toBe("INVALID_RANGE");
  });

  it("EMPTY_OPS for empty ops array", () => {
    const r = expectFailure(applyEdits({ content: "x", expectedRevision: rev("x"), ops: [] }));
    expect(r.failure.code).toBe("EMPTY_OPS");
  });

  it("TOO_MANY_OPS for ops.length > MAX_OPS", () => {
    const ops: EditOp[] = Array.from({ length: MAX_OPS + 1 }, () => ({
      kind: "replace_text",
      old: "x",
      new: "y",
    }));
    const r = expectFailure(applyEdits({ content: "x", expectedRevision: rev("x"), ops }));
    expect(r.failure.code).toBe("TOO_MANY_OPS");
    if (r.failure.code !== "TOO_MANY_OPS") return;
    expect(r.failure.ops_count).toBe(MAX_OPS + 1);
  });

  it("OVERLAPPING_OPS: insert strictly inside replace range (E3)", () => {
    const content = "Para A.\n\nPara B.";
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [
          { kind: "replace_lines", start_line: 1, end_line: 3, content: "X" },
          { kind: "insert_after_line", line: 1, content: "Y" },
        ],
      }),
    );
    expect(r.failure.code).toBe("OVERLAPPING_OPS");
  });

  it("Insert at boundary (O === A) — allowed, not overlapping", () => {
    const content = "Para A.\n\nPara B.";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [
          { kind: "replace_block", handle: "b1", content: "NEW B" },
          { kind: "insert_after_line", line: 0, content: "PREFIX\n" },
        ],
      }),
    );
    expect(r.newContent).toContain("PREFIX");
    expect(r.newContent).toContain("NEW B");
    expect(r.newContent).not.toContain("Para B.");
  });

  it("OVERLAPPING_OPS: two non-zero ranges sharing units", () => {
    const content = "abcdef\nghijkl";
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [
          { kind: "replace_lines", start_line: 1, end_line: 2, content: "X" },
          { kind: "replace_lines", start_line: 2, end_line: 2, content: "Y" },
        ],
      }),
    );
    expect(r.failure.code).toBe("OVERLAPPING_OPS");
  });

  it("DUPLICATE_OPS: two replace_text resolving to identical range", () => {
    const content = "abc def";
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [
          { kind: "replace_text", old: "abc", new: "X" },
          { kind: "replace_text", old: "abc", new: "Y" },
        ],
      }),
    );
    expect(r.failure.code).toBe("DUPLICATE_OPS");
  });

  it("CONTENT_TOO_LARGE when post-edit content exceeds limit", () => {
    const content = "x";
    const big = "y".repeat(MAX_CONTENT_LENGTH + 1);
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_block", handle: "b0", content: big }],
      }),
    );
    expect(r.failure.code).toBe("CONTENT_TOO_LARGE");
    if (r.failure.code !== "CONTENT_TOO_LARGE") return;
    expect(r.failure.proposed_length).toBeGreaterThan(MAX_CONTENT_LENGTH);
    expect(r.failure.delta_per_op).toHaveLength(1);
    expect(r.failure.delta_per_op[0]!.delta).toBeGreaterThan(0);
  });

  it("NO_MATCH for replace_text with no exact and no Tier 2 hit", () => {
    const content = "Hello, world.";
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_text", old: "completely missing text", new: "X" }],
      }),
    );
    expect(r.failure.code).toBe("NO_MATCH");
  });

  it("AMBIGUOUS_MATCH for replace_text with multiple Tier 1 hits", () => {
    const content = "foo bar foo baz";
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_text", old: "foo", new: "X" }],
      }),
    );
    expect(r.failure.code).toBe("AMBIGUOUS_MATCH");
  });
});

describe("applyEdits — atomicity invariants", () => {
  it("all ops resolve against ORIGINAL content even when applied descending", () => {
    const content = "AAA\n\nBBB\n\nCCC";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [
          { kind: "replace_block", handle: "b0", content: "NEW1" },
          { kind: "replace_block", handle: "b2", content: "NEW3" },
        ],
      }),
    );
    // If ops resolved against intermediate state (post-replace b0), b2's
    // offset_range from the original parse would refer to "BBB\n\nCCC" in
    // the modified content, breaking the second op. Verify final shape.
    expect(r.newContent).toBe("NEW1\n\nBBB\n\nNEW3");
  });

  it("CRLF line endings work via lineStarts (CR is just a regular char)", () => {
    // Note: our lineStarts only splits on '\n'; '\r\n' lines have '\r' as
    // the last char of each line. This is documented behavior — same as
    // String.prototype.split("\n").
    const content = "a\r\nb\r\nc";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_lines", start_line: 2, end_line: 2, content: "NEW" }],
      }),
    );
    // Line 2 spans from offset 3 (after "a\r\n") to offset 6 (start of "c").
    // Replacing it gives "a\r\nNEW" + "c" = "a\r\nNEWc" because line 2's
    // range is [3, 6) — the \r is part of line 2's leading content.
    // Actually [3, 6) in "a\r\nb\r\nc" = "b\r\n", so "a\r\n" + "NEW" + "c".
    expect(r.newContent).toBe("a\r\nNEWc");
  });

  it("vault check is the caller's responsibility — applyEdits only fails on revision/range/etc", () => {
    // applyEdits no longer rejects vault rows; the tool layer does.
    // This test confirms applyEdits accepts an arbitrary content + revision pair.
    const content = "X";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_block", handle: "b0", content: "Y" }],
      }),
    );
    expect(r.newContent).toBe("Y");
  });

  it("accepts exactly MAX_OPS at the boundary", () => {
    // Use bracketed tokens so "tok1" doesn't substring-match "tok10".
    const content = Array.from({ length: MAX_OPS }, (_, i) => `[t${i}]`).join("\n");
    const ops: EditOp[] = Array.from({ length: MAX_OPS }, (_, i) => ({
      kind: "replace_text",
      old: `[t${i}]`,
      new: `[X${i}]`,
    }));
    const r = expectSuccess(applyEdits({ content, expectedRevision: rev(content), ops }));
    expect(r.matchTiers).toHaveLength(MAX_OPS);
  });

  it("replace_text with empty new deletes the matched span", () => {
    const content = "abc foo def";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_text", old: " foo", new: "" }],
      }),
    );
    expect(r.newContent).toBe("abc def");
  });

  it("EOF insert does NOT double the newline when content already ends with \\n", () => {
    const content = "abc\n";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "insert_after_line", line: 1, content: "def" }],
      }),
    );
    expect(r.newContent).toBe("abc\ndef");
  });

  it("stacked inserts at non-EOF same offset preserve source-array order", () => {
    const content = "abc\ndef";
    const r = expectSuccess(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [
          { kind: "insert_after_line", line: 1, content: "X" },
          { kind: "insert_after_line", line: 1, content: "Y" },
          { kind: "insert_after_line", line: 1, content: "Z" },
        ],
      }),
    );
    // Inserts at start-of-line-2; source order X→Y→Z appears before "def".
    expect(r.newContent).toBe("abc\nXYZdef");
  });

  it("Tier-1 overlapping matches all surface in AMBIGUOUS_MATCH locations", () => {
    // findAllOccurrences uses from = idx + 1 so overlapping matches count.
    const content = "aaaa";
    const r = expectFailure(
      applyEdits({
        content,
        expectedRevision: rev(content),
        ops: [{ kind: "replace_text", old: "aa", new: "X" }],
      }),
    );
    expect(r.failure.code).toBe("AMBIGUOUS_MATCH");
    if (r.failure.code !== "AMBIGUOUS_MATCH") return;
    expect(r.failure.locations.length).toBeGreaterThanOrEqual(3);
  });
});

describe("parseBlocks options", () => {
  it("collectCodeRanges:false skips the recursive AST walk and returns empty codeRanges", async () => {
    const { parseBlocks } = await import("../../edit/block-parser.js");
    const content = "```\nfoo\n```\n\npara";
    const r = parseBlocks(content, { collectCodeRanges: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blocks.length).toBeGreaterThan(0);
    expect(r.codeRanges).toEqual([]);
  });
});

describe("applyEdits — PARSE_ERROR surfacing", () => {
  it("returns PARSE_ERROR when fromMarkdown throws (revision matches)", async () => {
    // Inject a synthetic throw via a mocked module. Use vi.doMock so other
    // tests in this file see the unmocked module.
    const mockThrow = vi.fn(() => {
      throw new Error("synthetic parser failure");
    });
    vi.doMock("mdast-util-from-markdown", () => ({ fromMarkdown: mockThrow }));
    // Reset the registry so the fresh mock is picked up by ops.ts → block-parser.ts.
    vi.resetModules();
    const { applyEdits: applyWithMock } = await import("../../edit/ops.js");
    const { computeRevision: revWithMock } = await import("../../edit/revision.js");
    const content = "anything";
    const r = applyWithMock({
      content,
      expectedRevision: revWithMock(content),
      ops: [{ kind: "replace_lines", start_line: 1, end_line: 1, content: "x" }],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure.code).toBe("PARSE_ERROR");
    if (r.failure.code !== "PARSE_ERROR") return;
    expect(r.failure.reason).toContain("synthetic parser failure");

    vi.doUnmock("mdast-util-from-markdown");
    vi.resetModules();
  });
});
