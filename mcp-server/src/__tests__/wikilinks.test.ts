import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeMockServer } from "./helpers.js";

vi.mock("../client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../client.js")>();
  return {
    ...actual,
    resolveWikilink: vi.fn(),
    rebuildReferenceIndex: vi.fn(),
  };
});

import * as client from "../client.js";
import { registerWikilinkTools } from "../tools/wikilinks.js";

const resolveWikilink = vi.mocked(client.resolveWikilink);
const rebuildReferenceIndex = vi.mocked(client.rebuildReferenceIndex);

describe("sparkle_resolve_wikilink", () => {
  let server: ReturnType<typeof makeMockServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = makeMockServer();
    registerWikilinkTools(server as unknown as Parameters<typeof registerWikilinkTools>[0]);
  });

  it("returns resolved:true with id/title/origin/snippet when match exists", async () => {
    resolveWikilink.mockResolvedValue({
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      title: "My Note",
      origin: "active",
      snippet: "first 200 chars of content",
    });

    const result = await server.getHandler("sparkle_resolve_wikilink")({ title: "My Note" });
    const body = JSON.parse(result.content[0]!.text);

    expect(body).toEqual({
      resolved: true,
      id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      title: "My Note",
      origin: "active",
      snippet: "first 200 chars of content",
    });
    expect(resolveWikilink).toHaveBeenCalledWith("My Note");
  });

  it("returns resolved:false on miss/collision (resolver returned null)", async () => {
    resolveWikilink.mockResolvedValue(null);

    const result = await server.getHandler("sparkle_resolve_wikilink")({ title: "NoSuch" });
    const body = JSON.parse(result.content[0]!.text);

    expect(body).toEqual({ resolved: false, title: "NoSuch" });
  });

  it("returns error response on client throw", async () => {
    resolveWikilink.mockRejectedValue(new Error("network down"));

    const result = await server.getHandler("sparkle_resolve_wikilink")({ title: "Foo" });
    expect(result.isError).toBe(true);
  });
});

describe("sparkle_rebuild_reference_index", () => {
  let server: ReturnType<typeof makeMockServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = makeMockServer();
    registerWikilinkTools(server as unknown as Parameters<typeof registerWikilinkTools>[0]);
  });

  it("returns queued count on success", async () => {
    rebuildReferenceIndex.mockResolvedValue({ status: "queued", queued: 42 });

    const result = await server.getHandler("sparkle_rebuild_reference_index")({});
    const body = JSON.parse(result.content[0]!.text);

    expect(body).toEqual({ status: "queued", queued: 42 });
    expect(rebuildReferenceIndex).toHaveBeenCalledOnce();
  });

  it("returns error response on client throw", async () => {
    rebuildReferenceIndex.mockRejectedValue(new Error("auth fail"));

    const result = await server.getHandler("sparkle_rebuild_reference_index")({});
    expect(result.isError).toBe(true);
  });
});
