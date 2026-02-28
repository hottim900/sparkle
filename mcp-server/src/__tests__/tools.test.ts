import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeItem, makeMockServer } from "./helpers.js";

// Mock client module
vi.mock("../client.js", () => ({
  searchItems: vi.fn(),
  getItem: vi.fn(),
  listItems: vi.fn(),
  createItem: vi.fn(),
  updateItem: vi.fn(),
  getStats: vi.fn(),
  getTags: vi.fn(),
  exportToObsidian: vi.fn(),
}));

import * as client from "../client.js";
import { registerSearchTools } from "../tools/search.js";
import { registerWriteTools } from "../tools/write.js";
import { registerWorkflowTools } from "../tools/workflow.js";
import { registerMetaTools } from "../tools/meta.js";

const searchItems = vi.mocked(client.searchItems);
const getItem = vi.mocked(client.getItem);
const listItems = vi.mocked(client.listItems);
const createItem = vi.mocked(client.createItem);
const updateItem = vi.mocked(client.updateItem);
const getStats = vi.mocked(client.getStats);
const getTags = vi.mocked(client.getTags);
const exportToObsidian = vi.mocked(client.exportToObsidian);

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
