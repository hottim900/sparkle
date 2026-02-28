import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Set env before importing client
const MOCK_URL = "http://test-sparkle:3000";
const MOCK_TOKEN = "test-token-12345";

// We need to mock env vars before the module loads, so use vi.stubEnv
beforeEach(() => {
  vi.stubEnv("SPARKLE_API_URL", MOCK_URL);
  vi.stubEnv("SPARKLE_AUTH_TOKEN", MOCK_TOKEN);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Dynamic import to pick up env vars — client reads env at module scope,
// so we reset modules each time
async function loadClient() {
  vi.resetModules();
  return import("../client.js");
}

function mockFetchOk(data: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

describe("searchItems", () => {
  it("calls correct URL with query params and auth header", async () => {
    const fetchMock = mockFetchOk({ results: [] });
    vi.stubGlobal("fetch", fetchMock);
    const { searchItems } = await loadClient();

    await searchItems("test query");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MOCK_URL}/api/search?q=test+query`);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe(`Bearer ${MOCK_TOKEN}`);
  });

  it("adds limit param when specified", async () => {
    const fetchMock = mockFetchOk({ results: [] });
    vi.stubGlobal("fetch", fetchMock);
    const { searchItems } = await loadClient();

    await searchItems("query", 10);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("limit=10");
  });
});

describe("getItem", () => {
  it("calls correct URL for item by ID", async () => {
    const fetchMock = mockFetchOk({ id: "abc-123" });
    vi.stubGlobal("fetch", fetchMock);
    const { getItem } = await loadClient();

    await getItem("abc-123");

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MOCK_URL}/api/items/abc-123`);
  });
});

describe("listItems", () => {
  it("calls /api/items with no params", async () => {
    const fetchMock = mockFetchOk({ items: [], total: 0 });
    vi.stubGlobal("fetch", fetchMock);
    const { listItems } = await loadClient();

    await listItems();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MOCK_URL}/api/items`);
  });

  it("builds correct query string with all params", async () => {
    const fetchMock = mockFetchOk({ items: [], total: 0 });
    vi.stubGlobal("fetch", fetchMock);
    const { listItems } = await loadClient();

    await listItems({
      status: "fleeting",
      type: "note",
      tag: "ai",
      sort: "modified",
      order: "desc",
      limit: 10,
      offset: 5,
    });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toContain("status=fleeting");
    expect(url).toContain("type=note");
    expect(url).toContain("tag=ai");
    expect(url).toContain("sort=modified");
    expect(url).toContain("order=desc");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=5");
  });
});

describe("getStats", () => {
  it("calls correct URL", async () => {
    const fetchMock = mockFetchOk({});
    vi.stubGlobal("fetch", fetchMock);
    const { getStats } = await loadClient();

    await getStats();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MOCK_URL}/api/stats`);
  });
});

describe("getTags", () => {
  it("calls correct URL", async () => {
    const fetchMock = mockFetchOk({ tags: [] });
    vi.stubGlobal("fetch", fetchMock);
    const { getTags } = await loadClient();

    await getTags();

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MOCK_URL}/api/tags`);
  });
});

describe("createItem", () => {
  it("sends POST with correct body including type default", async () => {
    const fetchMock = mockFetchOk({ id: "new-id" });
    vi.stubGlobal("fetch", fetchMock);
    const { createItem } = await loadClient();

    await createItem({ title: "New Note" });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MOCK_URL}/api/items`);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.title).toBe("New Note");
    expect(body.type).toBe("note");
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });
});

describe("updateItem", () => {
  it("sends PATCH with correct URL and body", async () => {
    const fetchMock = mockFetchOk({ id: "item-id" });
    vi.stubGlobal("fetch", fetchMock);
    const { updateItem } = await loadClient();

    await updateItem("item-id", { title: "Updated", status: "developing" });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MOCK_URL}/api/items/item-id`);
    expect(opts.method).toBe("PATCH");
    const body = JSON.parse(opts.body);
    expect(body.title).toBe("Updated");
    expect(body.status).toBe("developing");
  });
});

describe("exportToObsidian", () => {
  it("sends POST to correct export URL", async () => {
    const fetchMock = mockFetchOk({ path: "/vault/note.md" });
    vi.stubGlobal("fetch", fetchMock);
    const { exportToObsidian } = await loadClient();

    const result = await exportToObsidian("export-id");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(`${MOCK_URL}/api/items/export-id/export`);
    expect(opts.method).toBe("POST");
    expect(result.path).toBe("/vault/note.md");
  });
});

describe("error handling", () => {
  it("throws SparkleApiError on non-200 response", async () => {
    const fetchMock = mockFetchError(404, "Not found");
    vi.stubGlobal("fetch", fetchMock);
    const { getItem, SparkleApiError } = await loadClient();

    await expect(getItem("bad-id")).rejects.toThrow(SparkleApiError);
    await expect(getItem("bad-id")).rejects.toThrow("Not found");
  });

  it("parses JSON error body", async () => {
    const fetchMock = mockFetchError(400, JSON.stringify({ error: "Invalid input" }));
    vi.stubGlobal("fetch", fetchMock);
    const { createItem, SparkleApiError } = await loadClient();

    try {
      await createItem({ title: "Bad" });
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SparkleApiError);
      expect((e as InstanceType<typeof SparkleApiError>).message).toBe("Invalid input");
      expect((e as InstanceType<typeof SparkleApiError>).status).toBe(400);
    }
  });

  it("falls back to HTTP status when body is not JSON", async () => {
    const fetchMock = mockFetchError(500, "");
    vi.stubGlobal("fetch", fetchMock);
    const { getStats, SparkleApiError } = await loadClient();

    try {
      await getStats();
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SparkleApiError);
      expect((e as InstanceType<typeof SparkleApiError>).message).toBe("HTTP 500");
    }
  });
});
