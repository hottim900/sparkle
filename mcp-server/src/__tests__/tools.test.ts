import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeItem, makeMockServer } from "./helpers.js";

// Mock client module
vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>();
  return {
    ...actual,
    searchItems: vi.fn(),
    getItem: vi.fn(),
    listItems: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    getStats: vi.fn(),
    getTags: vi.fn(),
    exportToObsidian: vi.fn(),
    releaseVaultNote: vi.fn(),
    getVaultPathBySparkleId: vi.fn(),
  };
});

// Mock vault module
vi.mock("../vault.js", () => ({
  readVaultFileBySparkleId: vi.fn(),
  readVaultFileByPath: vi.fn(),
  writeVaultFileBySparkleId: vi.fn(),
  writeVaultFileByPath: vi.fn(),
  searchVault: vi.fn(),
  listVault: vi.fn(),
}));

import * as client from "../client.js";
import * as vault from "../vault.js";
import { registerReadTools } from "../tools/read.js";
import { registerSearchTools } from "../tools/search.js";
import { registerWriteTools } from "../tools/write.js";
import { registerWorkflowTools } from "../tools/workflow.js";
import { registerMetaTools } from "../tools/meta.js";
import { registerVaultTools } from "../tools/vault.js";

const searchItems = vi.mocked(client.searchItems);
const getItem = vi.mocked(client.getItem);
const listItems = vi.mocked(client.listItems);
const createItem = vi.mocked(client.createItem);
const updateItem = vi.mocked(client.updateItem);
const getStats = vi.mocked(client.getStats);
const getTags = vi.mocked(client.getTags);
const exportToObsidian = vi.mocked(client.exportToObsidian);
const releaseVaultNote = vi.mocked(client.releaseVaultNote);
const getVaultPathBySparkleId = vi.mocked(client.getVaultPathBySparkleId);
const readVaultFileBySparkleId = vi.mocked(vault.readVaultFileBySparkleId);
const readVaultFileByPath = vi.mocked(vault.readVaultFileByPath);
const writeVaultFileBySparkleId = vi.mocked(vault.writeVaultFileBySparkleId);
const writeVaultFileByPath = vi.mocked(vault.writeVaultFileByPath);
const mockSearchVault = vi.mocked(vault.searchVault);
const mockListVault = vi.mocked(vault.listVault);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sparkle_search", () => {
  it("returns formatted results on success", async () => {
    const server = makeMockServer();
    registerSearchTools(server as never);
    const handler = server.getHandler("sparkle_search");

    const items = [makeItem({ title: "Found Note" })];
    searchItems.mockResolvedValue({ results: items });

    const result = await handler({ query: "test", limit: 20 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Found Note");
    expect(searchItems).toHaveBeenCalledWith("test", 20);
  });

  it("returns isError on failure", async () => {
    const server = makeMockServer();
    registerSearchTools(server as never);
    const handler = server.getHandler("sparkle_search");

    searchItems.mockRejectedValue(new Error("Network error"));

    const result = await handler({ query: "fail", limit: 20 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Network error");
  });
});

describe("sparkle_search_all", () => {
  function getHandler() {
    const server = makeMockServer();
    registerSearchTools(server as never);
    return server.getHandler("sparkle_search_all");
  }

  it("returns results from both Sparkle and Vault", async () => {
    const handler = getHandler();
    searchItems.mockResolvedValue({
      results: [makeItem({ title: "DB Note", status: "developing" })],
    });
    mockSearchVault.mockResolvedValue([
      {
        path: "notes/vault-note.md",
        frontmatter: { tags: ["ai"] },
        matches: [{ line: 3, text: "vault match", context_before: [], context_after: [] }],
      },
    ]);

    const result = await handler({ query: "test", limit: 20 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("[Sparkle]");
    expect(result.content[0].text).toContain("DB Note");
    expect(result.content[0].text).toContain("[Vault]");
    expect(result.content[0].text).toContain("vault-note.md");
  });

  it("deduplicates exported items found in vault", async () => {
    const handler = getHandler();
    const exportedId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    searchItems.mockResolvedValue({
      results: [
        makeItem({ id: exportedId, title: "Exported Note", status: "exported" }),
        makeItem({ id: "other-id", title: "Active Note", status: "developing" }),
      ],
    });
    mockSearchVault.mockResolvedValue([
      {
        path: "notes/exported.md",
        frontmatter: { sparkle_id: exportedId },
        matches: [{ line: 1, text: "match", context_before: [], context_after: [] }],
      },
    ]);

    const result = await handler({ query: "test", limit: 20 });
    expect(result.content[0].text).toContain("Active Note");
    expect(result.content[0].text).not.toContain("Exported Note");
    expect(result.content[0].text).toContain("exported.md");
  });

  it("falls back to Sparkle-only when vault is not enabled", async () => {
    const handler = getHandler();
    searchItems.mockResolvedValue({
      results: [makeItem({ title: "Sparkle Result" })],
    });
    mockSearchVault.mockRejectedValue(new Error("Obsidian integration is not enabled"));

    const result = await handler({ query: "test", limit: 20 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Sparkle Result");
    expect(result.content[0].text).not.toContain("[Vault]");
  });

  it("returns friendly message when both sources are empty", async () => {
    const handler = getHandler();
    searchItems.mockResolvedValue({ results: [] });
    mockSearchVault.mockResolvedValue([]);

    const result = await handler({ query: "nonexistent", limit: 20 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("No results found");
  });
});

describe("sparkle_list_notes", () => {
  function getListHandler() {
    const server = makeMockServer();
    registerReadTools(server as never);
    return server.getHandler("sparkle_list_notes");
  }

  it("passes category_id and order to listItems", async () => {
    const handler = getListHandler();
    listItems.mockResolvedValue({ items: [], total: 0 });

    await handler({
      type: "note",
      sort: "created",
      order: "asc",
      category_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      limit: 50,
      offset: 0,
    });
    expect(listItems).toHaveBeenCalledWith({
      status: undefined,
      tag: undefined,
      type: "note",
      category_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      sort: "created",
      order: "asc",
      limit: 50,
      offset: 0,
    });
  });

  it("includes pagination footer in output", async () => {
    const handler = getListHandler();
    listItems.mockResolvedValue({
      items: [makeItem({ title: "Note 1" })],
      total: 5,
    });

    const result = await handler({
      type: "note",
      sort: "created",
      order: "desc",
      limit: 1,
      offset: 0,
    });
    expect(result.content[0].text).toContain(
      "Offset: 0 | Limit: 1 | Has more: yes | Next offset: 1",
    );
  });

  it("forwards include_vault=true to listItems", async () => {
    const handler = getListHandler();
    listItems.mockResolvedValue({ items: [], total: 0 });

    await handler({
      type: "note",
      include_vault: true,
      sort: "created",
      order: "desc",
      limit: 50,
      offset: 0,
    });
    expect(listItems).toHaveBeenCalledWith(
      expect.objectContaining({ include_vault: true, type: "note" }),
    );
  });

  it("omits include_vault when caller does not set it (default active-only)", async () => {
    const handler = getListHandler();
    listItems.mockResolvedValue({ items: [], total: 0 });

    await handler({
      type: "note",
      sort: "created",
      order: "desc",
      limit: 50,
      offset: 0,
    });
    const call = listItems.mock.calls[0]![0]!;
    expect(call.include_vault).toBeUndefined();
  });

  it("renders vault rows (status='exported') returned when include_vault=true", async () => {
    const handler = getListHandler();
    listItems.mockResolvedValue({
      items: [
        makeItem({ title: "Active note", status: "developing" }),
        makeItem({
          id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
          title: "Vault note",
          status: "exported",
          origin: "vault",
        }),
      ],
      total: 2,
    });

    const result = await handler({
      type: "note",
      include_vault: true,
      sort: "created",
      order: "desc",
      limit: 50,
      offset: 0,
    });
    const text = result.content[0].text;
    expect(text).toContain("Active note");
    expect(text).toContain("Vault note");
    expect(text).toContain("exported");
  });

  it("with status='exported' passes the filter to listItems", async () => {
    const handler = getListHandler();
    listItems.mockResolvedValue({ items: [], total: 0 });

    await handler({
      type: "note",
      status: "exported",
      sort: "created",
      order: "desc",
      limit: 50,
      offset: 0,
    });
    expect(listItems).toHaveBeenCalledWith(
      expect.objectContaining({ status: "exported", type: "note" }),
    );
  });
});

describe("sparkle_get_note", () => {
  function getReadHandler() {
    const server = makeMockServer();
    registerReadTools(server as never);
    return server.getHandler("sparkle_get_note");
  }

  it("accepts short ID prefix (8 chars)", async () => {
    const handler = getReadHandler();
    const item = makeItem({ title: "Found by prefix" });
    getItem.mockResolvedValue(item);

    const result = await handler({ id: "a4662876" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Found by prefix");
    expect(getItem).toHaveBeenCalledWith("a4662876");
  });

  it("still accepts full UUID", async () => {
    const handler = getReadHandler();
    const item = makeItem();
    getItem.mockResolvedValue(item);

    const result = await handler({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    expect(result.isError).toBeUndefined();
    expect(getItem).toHaveBeenCalledWith("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("returns error when item not found", async () => {
    const handler = getReadHandler();
    getItem.mockRejectedValue(new Error("Not found"));

    const result = await handler({ id: "deadbeef" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Not found");
  });
});

describe("sparkle_update_note (metadata-only post v2 cutover)", () => {
  function getUpdateHandler() {
    const server = makeMockServer();
    registerWriteTools(server as never);
    return server.getHandler("sparkle_update_note");
  }

  it("updates title without touching content (no content key in PATCH body — L3)", async () => {
    const handler = getUpdateHandler();
    updateItem.mockResolvedValue(makeItem({ title: "New title" }));

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      title: "New title",
    });
    expect(result.isError).toBeUndefined();
    const callArgs = updateItem.mock.calls[0]![1]!;
    expect(callArgs).toEqual({ title: "New title" });
    expect("content" in callArgs).toBe(false);
    // No content fetch — metadata edits skip the body.
    expect(getItem).not.toHaveBeenCalled();
  });
});

describe("sparkle_get_note edit-context", () => {
  function getReadHandler() {
    const server = makeMockServer();
    registerReadTools(server as never);
    return server.getHandler("sparkle_get_note");
  }

  it("active item: response carries revision + lines + blocks JSON block", async () => {
    const handler = getReadHandler();
    getItem.mockResolvedValue(makeItem({ content: "Hello.", origin: "web" }));

    const result = await handler({ id: "aaaaaaaa" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("```edit-context");
    expect(text).toMatch(/"revision": "[a-f0-9]{64}"/);
    expect(text).toContain('"lines"');
    expect(text).toContain('"blocks"');
  });

  it("vault item: edit-context fields are null", async () => {
    const handler = getReadHandler();
    getItem.mockResolvedValue(makeItem({ content: "snippet only", origin: "vault" }));

    const result = await handler({ id: "aaaaaaaa" });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toMatch(/"revision": null/);
    expect(text).toMatch(/"lines": null/);
    expect(text).toMatch(/"blocks": null/);
  });
});

describe("sparkle_create_note edit-context", () => {
  function getCreateHandler() {
    const server = makeMockServer();
    registerWriteTools(server as never);
    return server.getHandler("sparkle_create_note");
  }

  it("response includes edit-context for the new active item", async () => {
    const handler = getCreateHandler();
    createItem.mockResolvedValue(makeItem({ content: "Body.", origin: "web" }));

    const result = await handler({ title: "New", content: "Body." });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain("```edit-context");
    expect(text).toMatch(/"revision": "[a-f0-9]{64}"/);
  });
});

describe("sparkle_edit_note", () => {
  function getEditHandler() {
    const server = makeMockServer();
    registerWriteTools(server as never);
    return server.getHandler("sparkle_edit_note");
  }

  const VALID_REV = "a".repeat(64); // 64-char lowercase hex

  it("vault-origin returns canonical VAULT_READONLY payload (with vault_path_source)", async () => {
    const handler = getEditHandler();
    getItem.mockResolvedValue(makeItem({ content: "snippet", origin: "vault" }));
    getVaultPathBySparkleId.mockResolvedValue({ path: "Notes/foo.md" });

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      revision: VALID_REV,
      ops: [{ kind: "replace_text", old: "x", new: "y" }],
    });
    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.code).toBe("VAULT_READONLY");
    expect(payload.vault_path).toBe("Notes/foo.md");
    expect(payload.vault_path_source).toBe("lookup");
    expect(payload.hint_tool_by_id).toBe("sparkle_write_obsidian");
    // applyEdits never reached
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("vault-origin with null vault_path: vault_path_source is null", async () => {
    const handler = getEditHandler();
    getItem.mockResolvedValue(makeItem({ content: "snippet", origin: "vault" }));
    getVaultPathBySparkleId.mockResolvedValue(null);

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      revision: VALID_REV,
      ops: [{ kind: "replace_text", old: "x", new: "y" }],
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.vault_path).toBeNull();
    expect(payload.vault_path_source).toBeNull();
  });

  it("REVISION_MISMATCH on stale revision returns fresh revision/lines/blocks", async () => {
    const handler = getEditHandler();
    getItem.mockResolvedValue(makeItem({ content: "Hello.", origin: "web" }));

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      revision: "0".repeat(64),
      ops: [{ kind: "replace_block", handle: "b0", content: "X" }],
    });
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("REVISION_MISMATCH");
    expect(text).toMatch(/"current_revision":\s*"[a-f0-9]{64}"/);
    expect(text).toContain('"lines":');
    expect(text).toContain('"blocks":');
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("happy path: replace_block applies and response carries match_tiers", async () => {
    const handler = getEditHandler();
    const current = makeItem({ content: "Old.", origin: "web" });
    getItem.mockResolvedValue(current);
    updateItem.mockResolvedValue(makeItem({ content: "New body.", origin: "web" }));

    const result = await handler({
      id: current.id,
      revision: computeRevisionForTest("Old."),
      ops: [{ kind: "replace_block", handle: "b0", content: "New body." }],
    });
    expect(result.isError).toBeUndefined();
    expect(updateItem).toHaveBeenCalledWith(current.id, { content: "New body." });
    const text = result.content[0].text;
    expect(text).toContain("Note edited successfully.");
    expect(text).toMatch(/"match_tiers":\s*\[\s*null\s*\]/);
  });

  it("replace_text Tier 2: match_tiers includes punctuation_normalized", async () => {
    const handler = getEditHandler();
    const current = makeItem({ content: "結束：完。", origin: "web" });
    getItem.mockResolvedValue(current);
    updateItem.mockResolvedValue(makeItem({ content: "結束完成。", origin: "web" }));

    const result = await handler({
      id: current.id,
      revision: computeRevisionForTest("結束：完。"),
      ops: [{ kind: "replace_text", old: "結束:完.", new: "結束完成。" }],
    });
    expect(result.isError).toBeUndefined();
    const text = result.content[0].text;
    expect(text).toContain('"punctuation_normalized"');
  });

  it("propagates SparkleApiError from getItem", async () => {
    const handler = getEditHandler();
    getItem.mockRejectedValue(new client.SparkleApiError("Not Found", 404));

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      revision: VALID_REV,
      ops: [{ kind: "replace_text", old: "x", new: "y" }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("404");
  });

  it("NO_MATCH surfaces via tool layer with rendered failure (no updateItem call)", async () => {
    const handler = getEditHandler();
    const item = makeItem({ content: "Hello.", origin: "web" });
    getItem.mockResolvedValue(item);

    const result = await handler({
      id: item.id,
      revision: computeRevisionForTest("Hello."),
      ops: [{ kind: "replace_text", old: "completely missing", new: "X" }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("NO_MATCH");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("AMBIGUOUS_MATCH surfaces via tool layer with locations payload", async () => {
    const handler = getEditHandler();
    const item = makeItem({ content: "foo bar foo baz", origin: "web" });
    getItem.mockResolvedValue(item);

    const result = await handler({
      id: item.id,
      revision: computeRevisionForTest("foo bar foo baz"),
      ops: [{ kind: "replace_text", old: "foo", new: "X" }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("AMBIGUOUS_MATCH");
    expect(result.content[0].text).toContain("locations");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("INVALID_HANDLE surfaces via tool layer with valid_handles list", async () => {
    const handler = getEditHandler();
    const item = makeItem({ content: "Para.", origin: "web" });
    getItem.mockResolvedValue(item);

    const result = await handler({
      id: item.id,
      revision: computeRevisionForTest("Para."),
      ops: [{ kind: "replace_block", handle: "b99", content: "X" }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("INVALID_HANDLE");
    expect(result.content[0].text).toContain("valid_handles");
    expect(updateItem).not.toHaveBeenCalled();
  });
});

// Helper for tests that need to compute a revision matching getItem's
// returned content. Mirrors edit/revision.ts but avoids importing client
// internals here.
import { createHash } from "node:crypto";
function computeRevisionForTest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

describe("sparkle_advance_note", () => {
  function getAdvanceHandler() {
    const server = makeMockServer();
    registerWorkflowTools(server as never);
    return server.getHandler("sparkle_advance_note");
  }

  it("rejects non-note items", async () => {
    const handler = getAdvanceHandler();
    getItem.mockResolvedValue(makeItem({ type: "todo", status: "active" }));

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      target_status: "developing",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not a note");
  });

  it("rejects wrong source status", async () => {
    const handler = getAdvanceHandler();
    getItem.mockResolvedValue(makeItem({ type: "note", status: "developing" }));

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      target_status: "developing",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('must be "fleeting"');
  });

  it("advances fleeting to developing", async () => {
    const handler = getAdvanceHandler();
    getItem.mockResolvedValue(makeItem({ type: "note", status: "fleeting" }));
    updateItem.mockResolvedValue(makeItem({ type: "note", status: "developing" }));

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      target_status: "developing",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('advanced to "developing"');
    expect(updateItem).toHaveBeenCalledWith("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", {
      status: "developing",
    });
  });

  it("advances developing to permanent", async () => {
    const handler = getAdvanceHandler();
    getItem.mockResolvedValue(makeItem({ type: "note", status: "developing" }));
    updateItem.mockResolvedValue(makeItem({ type: "note", status: "permanent" }));

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      target_status: "permanent",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('advanced to "permanent"');
  });
});

describe("sparkle_pause_note / sparkle_resume_note — vault pre-check", () => {
  function getHandlers() {
    const server = makeMockServer();
    registerWorkflowTools(server as never);
    return {
      pause: server.getHandler("sparkle_pause_note"),
      resume: server.getHandler("sparkle_resume_note"),
    };
  }

  it("pause rejects vault-origin item with VAULT_READONLY", async () => {
    const { pause } = getHandlers();
    getItem.mockResolvedValue(makeItem({ origin: "vault", status: "exported" }));

    const result = await pause({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("VAULT_READONLY");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("pause proceeds for active item", async () => {
    const { pause } = getHandlers();
    getItem.mockResolvedValue(makeItem({ origin: "web", status: "developing" }));
    updateItem.mockResolvedValue(makeItem({ paused: 1 }));

    const result = await pause({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    expect(result.isError).toBeUndefined();
    expect(updateItem).toHaveBeenCalledWith("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", {
      paused: true,
    });
  });

  it("resume rejects vault-origin item with VAULT_READONLY", async () => {
    const { resume } = getHandlers();
    getItem.mockResolvedValue(makeItem({ origin: "vault", status: "exported" }));

    const result = await resume({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("VAULT_READONLY");
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("resume proceeds for active paused item", async () => {
    const { resume } = getHandlers();
    getItem.mockResolvedValue(
      makeItem({ origin: "web", status: "developing", paused: 1, paused_context: "memo" }),
    );
    updateItem.mockResolvedValue(makeItem({ paused: 0 }));

    const result = await resume({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("memo");
  });
});

describe("sparkle_export_to_obsidian", () => {
  function getExportHandler() {
    const server = makeMockServer();
    registerWorkflowTools(server as never);
    return server.getHandler("sparkle_export_to_obsidian");
  }

  it("returns file path on success", async () => {
    const handler = getExportHandler();
    exportToObsidian.mockResolvedValue({ path: "/vault/notes/My Note.md" });

    const result = await handler({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("/vault/notes/My Note.md");
  });

  it("returns isError with guidance on failure", async () => {
    const handler = getExportHandler();
    exportToObsidian.mockRejectedValue(new Error("Not permanent"));

    const result = await handler({ id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Not permanent");
    expect(result.content[0].text).toContain("permanent");
  });
});

describe("sparkle_release_note", () => {
  function getReleaseHandler() {
    const server = makeMockServer();
    registerWorkflowTools(server as never);
    return server.getHandler("sparkle_release_note");
  }

  const VAULT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

  it("refuses when confirm=false (does not call release)", async () => {
    const handler = getReleaseHandler();
    const result = await handler({ note_id: VAULT_ID, confirm: false });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("confirm must be true");
    expect(releaseVaultNote).not.toHaveBeenCalled();
  });

  it("refuses when item is not vault-origin", async () => {
    const handler = getReleaseHandler();
    getItem.mockResolvedValue(makeItem({ type: "note", status: "permanent" }));
    const result = await handler({ note_id: VAULT_ID, confirm: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not a vault item");
    expect(releaseVaultNote).not.toHaveBeenCalled();
  });

  it("releases the vault stub when confirm=true and item is vault-origin", async () => {
    const handler = getReleaseHandler();
    const vaultItem = makeItem({
      id: VAULT_ID,
      type: "note",
      status: "exported",
    });
    // makeItem doesn't set origin; inject vault origin marker on the response
    getItem.mockResolvedValue({ ...vaultItem, origin: "vault" } as never);
    releaseVaultNote.mockResolvedValue({
      ok: true,
      id: VAULT_ID,
      vault_path: "Notes/released.md",
    });

    const result = await handler({ note_id: VAULT_ID, confirm: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("已釋出");
    expect(result.content[0].text).toContain("Notes/released.md");
    expect(releaseVaultNote).toHaveBeenCalledWith(VAULT_ID);
  });

  it("returns formatted error when API request fails", async () => {
    const handler = getReleaseHandler();
    getItem.mockResolvedValue({
      ...makeItem({ id: VAULT_ID }),
      origin: "vault",
    } as never);
    releaseVaultNote.mockRejectedValue(new Error("network down"));

    const result = await handler({ note_id: VAULT_ID, confirm: true });
    expect(result.isError).toBe(true);
  });
});

describe("sparkle_get_stats", () => {
  it("returns formatted stats", async () => {
    const server = makeMockServer();
    registerMetaTools(server as never);
    const handler = server.getHandler("sparkle_get_stats");

    getStats.mockResolvedValue({
      fleeting_count: 5,
      developing_count: 3,
      permanent_count: 10,
      exported_this_week: 1,
      exported_this_month: 4,
      active_count: 8,
      done_this_week: 2,
      done_this_month: 6,
      created_this_week: 3,
      created_this_month: 15,
      overdue_count: 1,
    });

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Fleeting: **5**");
    expect(result.content[0].text).toContain("Active: **8**");
  });
});

describe("sparkle_list_tags", () => {
  it("returns formatted tags", async () => {
    const server = makeMockServer();
    registerMetaTools(server as never);
    const handler = server.getHandler("sparkle_list_tags");

    getTags.mockResolvedValue({ tags: ["ai", "research"] });

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Found 2 tags:");
    expect(result.content[0].text).toContain("- ai");
  });
});

// --- Vault tools ---

const makeVaultFile = (
  overrides: Partial<import("../types.js").VaultFile> = {},
): import("../types.js").VaultFile => ({
  path: "0_Inbox/Test Note.md",
  content: '---\nsparkle_id: "abc-123"\ntags:\n  - test\n---\n\n# Test Note\n\nBody here.',
  frontmatter: { sparkle_id: "abc-123", tags: ["test"] },
  body: "# Test Note\n\nBody here.",
  ...overrides,
});

describe("sparkle_read_obsidian", () => {
  function getHandler() {
    const server = makeMockServer();
    registerVaultTools(server as never);
    return server.getHandler("sparkle_read_obsidian");
  }

  it("returns formatted vault file on success", async () => {
    const handler = getHandler();
    readVaultFileBySparkleId.mockResolvedValue(makeVaultFile());

    const result = await handler({ sparkle_id: "abc-123" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("0_Inbox/Test Note.md");
    expect(result.content[0].text).toContain("abc-123");
    expect(result.content[0].text).toContain("Body here.");
  });

  it("returns error when file not found", async () => {
    const handler = getHandler();
    readVaultFileBySparkleId.mockRejectedValue(
      new Error("No vault file found with sparkle_id: xyz"),
    );

    const result = await handler({ sparkle_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No vault file found");
  });
});

describe("sparkle_write_obsidian", () => {
  function getHandler() {
    const server = makeMockServer();
    registerVaultTools(server as never);
    return server.getHandler("sparkle_write_obsidian");
  }

  it("returns success with path", async () => {
    const handler = getHandler();
    writeVaultFileBySparkleId.mockResolvedValue("0_Inbox/Test Note.md");

    const result = await handler({
      sparkle_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      content: "# Updated content",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("0_Inbox/Test Note.md");
    expect(result.content[0].text).toContain("updated successfully");
  });

  it("returns error on failure", async () => {
    const handler = getHandler();
    writeVaultFileBySparkleId.mockRejectedValue(new Error("No vault file found"));

    const result = await handler({
      sparkle_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      content: "content",
    });
    expect(result.isError).toBe(true);
  });
});

describe("sparkle_read_obsidian_by_path", () => {
  function getHandler() {
    const server = makeMockServer();
    registerVaultTools(server as never);
    return server.getHandler("sparkle_read_obsidian_by_path");
  }

  it("returns formatted vault file", async () => {
    const handler = getHandler();
    readVaultFileByPath.mockResolvedValue(makeVaultFile({ path: "Projects/note.md" }));

    const result = await handler({ path: "Projects/note.md" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Projects/note.md");
  });

  it("returns error for nonexistent file", async () => {
    const handler = getHandler();
    readVaultFileByPath.mockRejectedValue(new Error("File not found: nope.md"));

    const result = await handler({ path: "nope.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("File not found");
  });
});

describe("sparkle_write_obsidian_by_path", () => {
  function getHandler() {
    const server = makeMockServer();
    registerVaultTools(server as never);
    return server.getHandler("sparkle_write_obsidian_by_path");
  }

  it("returns success with path", async () => {
    const handler = getHandler();
    writeVaultFileByPath.mockResolvedValue("new/note.md");

    const result = await handler({ path: "new/note.md", content: "# New" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("new/note.md");
    expect(result.content[0].text).toContain("written successfully");
  });

  it("returns error on path traversal", async () => {
    const handler = getHandler();
    writeVaultFileByPath.mockRejectedValue(new Error("outside the vault"));

    const result = await handler({ path: "../../../etc/passwd.md", content: "bad" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("outside the vault");
  });
});

describe("sparkle_search_obsidian", () => {
  function getHandler() {
    const server = makeMockServer();
    registerVaultTools(server as never);
    return server.getHandler("sparkle_search_obsidian");
  }

  it("returns formatted search results", async () => {
    const handler = getHandler();
    mockSearchVault.mockResolvedValue([
      {
        path: "notes/research.md",
        frontmatter: { sparkle_id: "abc-123", tags: ["ai", "ml"] },
        matches: [
          {
            line: 5,
            text: "This is about machine learning",
            context_before: ["## Introduction"],
            context_after: ["and deep learning"],
          },
        ],
      },
    ]);

    const result = await handler({ query: "machine", limit: 20 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('1 file(s) matching "machine"');
    expect(result.content[0].text).toContain("notes/research.md");
    expect(result.content[0].text).toContain("sparkle_id: abc-123");
    expect(result.content[0].text).toContain("machine learning");
  });

  it("returns friendly message when no results", async () => {
    const handler = getHandler();
    mockSearchVault.mockResolvedValue([]);

    const result = await handler({ query: "nonexistent", limit: 20 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No results found for "nonexistent"');
  });
});

describe("sparkle_list_obsidian", () => {
  function getHandler() {
    const server = makeMockServer();
    registerVaultTools(server as never);
    return server.getHandler("sparkle_list_obsidian");
  }

  it("returns formatted file list", async () => {
    const handler = getHandler();
    mockListVault.mockResolvedValue({
      files: [
        { path: "notes/idea.md", frontmatter: { sparkle_id: "abc-123", tags: ["ai"] } },
        { path: "projects/plan.md", frontmatter: {} },
      ],
      directories: [],
    });

    const result = await handler({ recursive: true, limit: 50 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Files:** (2)");
    expect(result.content[0].text).toContain("notes/idea.md");
    expect(result.content[0].text).toContain("sparkle_id: abc-123");
    expect(result.content[0].text).toContain("projects/plan.md");
    expect(result.content[0].text).toContain("(no frontmatter)");
  });

  it("includes directories in non-recursive mode", async () => {
    const handler = getHandler();
    mockListVault.mockResolvedValue({
      files: [{ path: "note.md", frontmatter: {} }],
      directories: ["Projects", "Archive"],
    });

    const result = await handler({ recursive: false, limit: 50 });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Directories:** (2)");
    expect(result.content[0].text).toContain("Projects/");
    expect(result.content[0].text).toContain("Archive/");
  });
});

describe("error handling", () => {
  it("includes HTTP status for SparkleApiError", async () => {
    const server = makeMockServer();
    registerReadTools(server as never);
    const handler = server.getHandler("sparkle_get_note");

    getItem.mockRejectedValue(new client.SparkleApiError("Not Found", 404));

    const result = await handler({ id: "a4662876-1234-5678-9abc-def012345678" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("Error (HTTP 404): Not Found");
  });
});

// --- Source file regression guards ---

const { readdirSync, readFileSync } = require("fs");
const { join } = require("path");
const toolsDir = join(__dirname, "../tools");

function readToolSource(filename: string): string {
  return readFileSync(join(toolsDir, filename), "utf-8");
}

describe("strict schema validation", () => {
  it("all tool inputSchemas use z.object().strict(), not raw shapes", () => {
    const toolFiles = readdirSync(toolsDir).filter((f: string) => f.endsWith(".ts"));

    for (const file of toolFiles) {
      const content = readFileSync(join(toolsDir, file), "utf-8");
      const rawShapes = content.match(/inputSchema:\s*\{/g);
      expect(
        rawShapes,
        `${file} has raw inputSchema — must use z.object({...}).strict()`,
      ).toBeNull();
    }
  });

  it("sparkle_update_note rejects legacy content/old_content with V2 cutover hint (DX-D4)", () => {
    // We can't trigger MCP-level zod parsing through the makeMockServer helper
    // (it stores raw handlers), but we can read the schema source to verify
    // both fields are listed with `z.never()` + a migration hint pointing to
    // sparkle_edit_note. Without this, .strict() would surface a generic
    // "unrecognized key" error and the LLM would have no migration guidance.
    const writeSrc = readToolSource("write.ts");
    expect(writeSrc).toMatch(/content:\s*z\s*\.\s*never\(/);
    expect(writeSrc).toMatch(/old_content:\s*z\s*\.\s*never\(/);
    expect(writeSrc).toMatch(/RETIRED in v2.*sparkle_edit_note/i);
  });

  it("sparkle_edit_note ops schema is a zod discriminated union keyed on `kind` (M9)", async () => {
    // Runtime introspection — survives a comment-style refactor that the
    // prior source-string regex would have falsely passed.
    const writeSrc = readToolSource("write.ts");
    expect(writeSrc).toMatch(/z\.discriminatedUnion\(\s*"kind"/);

    // Also verify the schema actually behaves as a discriminated union:
    // a malformed op (wrong `kind`) must surface a kind-discriminator error,
    // not "unrecognized fields" — the former proves the union is wired up.
    const { z } = await import("zod");
    const editOpSchema = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("replace_block"), handle: z.string(), content: z.string() }),
      z.object({ kind: z.literal("replace_text"), old: z.string(), new: z.string() }),
    ]);
    const result = editOpSchema.safeParse({ kind: "not_a_kind", handle: "b0", content: "x" });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = JSON.stringify(result.error.issues);
    expect(issues).toMatch(/invalid_(union|literal_value|enum)/i);
  });
});

describe("tool description completeness", () => {
  it("sparkle_update_note description warns about type conversion field clearing", () => {
    const content = readToolSource("write.ts");
    expect(content).toMatch(/[Tt]ype change.*scratch.*clear/);
  });

  it("sparkle_update_note description rejects vault-origin writes (VAULT_READONLY)", () => {
    const content = readToolSource("write.ts");
    expect(content).toMatch(/vault-origin.*VAULT_READONLY/i);
  });
});
