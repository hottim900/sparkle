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
    expect(result.content[0].text).toContain("Offset: 0 | Limit: 1 | Has more: yes | Next offset: 1");
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

describe("sparkle_update_note", () => {
  function getUpdateHandler() {
    const server = makeMockServer();
    registerWriteTools(server as never);
    return server.getHandler("sparkle_update_note");
  }

  it("returns error when old_content provided without content", async () => {
    const handler = getUpdateHandler();

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      old_content: "old text",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("content is required");
  });

  it("performs find-and-replace on single match", async () => {
    const handler = getUpdateHandler();
    const current = makeItem({ content: "Hello world, this is a test." });
    getItem.mockResolvedValue(current);
    updateItem.mockResolvedValue(makeItem({ content: "Hello universe, this is a test." }));

    const result = await handler({
      id: current.id,
      old_content: "world",
      content: "universe",
    });
    expect(result.isError).toBeUndefined();
    expect(updateItem).toHaveBeenCalledWith(current.id, {
      content: "Hello universe, this is a test.",
    });
  });

  it("returns NO_MATCH when old_content not found", async () => {
    const handler = getUpdateHandler();
    const current = makeItem({ content: "Hello world." });
    getItem.mockResolvedValue(current);

    const result = await handler({
      id: current.id,
      old_content: "nonexistent text",
      content: "replacement",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("NO_MATCH");
  });

  it("returns AMBIGUOUS_MATCH when old_content found multiple times", async () => {
    const handler = getUpdateHandler();
    const current = makeItem({ content: "foo bar foo baz foo" });
    getItem.mockResolvedValue(current);

    const result = await handler({
      id: current.id,
      old_content: "foo",
      content: "qux",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("AMBIGUOUS_MATCH");
    expect(result.content[0].text).toContain("3 times");
  });

  it("performs full content replace when only content provided", async () => {
    const handler = getUpdateHandler();
    updateItem.mockResolvedValue(makeItem({ content: "brand new content" }));

    const result = await handler({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      content: "brand new content",
    });
    expect(result.isError).toBeUndefined();
    expect(updateItem).toHaveBeenCalledWith("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", {
      content: "brand new content",
    });
    // Should NOT call getItem for full replace
    expect(getItem).not.toHaveBeenCalled();
  });
});

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

const makeVaultFile = (overrides: Partial<import("../types.js").VaultFile> = {}): import("../types.js").VaultFile => ({
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
    readVaultFileBySparkleId.mockRejectedValue(new Error("No vault file found with sparkle_id: xyz"));

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
