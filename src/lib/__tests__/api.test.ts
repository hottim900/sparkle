/**
 * Tests for the request<T>() wrapper and API function wrappers in api.ts.
 *
 * fetchWithRetry() is tested separately in fetch-with-retry.test.ts (17 tests).
 * These tests mock the global fetch to return immediate responses, so
 * fetchWithRetry passes through without retries, and we can verify the
 * request() layer: token management, headers, 401 handling, JSON parsing,
 * and URL construction in the API wrapper functions.
 */

// Helper to create a mock Response
function mockResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Helper for non-JSON response
function mockNonJsonResponse(status: number): Response {
  return new Response("Not JSON", {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

describe("API client — request<T>() wrapper", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    reloadMock = vi.fn();
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...window.location, reload: reloadMock },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Token / Headers ---

  describe("Token and Headers", () => {
    it("adds Authorization header when token exists", async () => {
      const { listItems, setToken } = await import("@/lib/api");
      setToken("my-secret-token");
      fetchSpy.mockResolvedValue(mockResponse(200, { items: [], total: 0 }));

      await listItems();

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders).toHaveProperty("Authorization", "Bearer my-secret-token");
    });

    it("does not add Authorization header when no token", async () => {
      const { listItems, clearToken } = await import("@/lib/api");
      clearToken();
      fetchSpy.mockResolvedValue(mockResponse(200, { items: [], total: 0 }));

      await listItems();

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders).not.toHaveProperty("Authorization");
    });

    it("adds Content-Type: application/json for POST with body", async () => {
      const { createItem } = await import("@/lib/api");
      fetchSpy.mockResolvedValue(mockResponse(200, { id: "1", title: "test" }));

      await createItem({ title: "test" });

      const callHeaders = fetchSpy.mock.calls[0][1].headers;
      expect(callHeaders).toHaveProperty("Content-Type", "application/json");
    });
  });

  // --- 401 Response ---

  describe("401 Response handling", () => {
    it("clears token and reloads on 401 response", async () => {
      const { listItems, setToken } = await import("@/lib/api");
      setToken("old-token");
      fetchSpy.mockResolvedValue(mockResponse(401, { error: "Unauthorized" }));

      await expect(listItems()).rejects.toThrow();

      expect(localStorage.getItem("auth_token")).toBeNull();
      expect(reloadMock).toHaveBeenCalledOnce();
    });

    it("throws without reload on non-401 error", async () => {
      const { listItems } = await import("@/lib/api");
      fetchSpy.mockResolvedValue(mockResponse(404, { error: "Not found" }));

      await expect(listItems()).rejects.toThrow("Not found");
      expect(reloadMock).not.toHaveBeenCalled();
    });
  });

  // --- JSON Parsing ---

  describe("JSON parsing", () => {
    it("returns parsed JSON data on success", async () => {
      const { getItem } = await import("@/lib/api");
      const itemData = { id: "abc", title: "Test Item", type: "note" };
      fetchSpy.mockResolvedValue(mockResponse(200, itemData));

      const result = await getItem("abc");

      expect(result).toEqual(itemData);
    });

    it("throws with server error message when response has error field", async () => {
      const { getItem } = await import("@/lib/api");
      fetchSpy.mockResolvedValue(mockResponse(400, { error: "Validation failed: title required" }));

      await expect(getItem("abc")).rejects.toThrow("Validation failed: title required");
    });

    it("throws generic error when error response is not valid JSON", async () => {
      const { getItem } = await import("@/lib/api");
      // Use 400 (not 500) to avoid fetchWithRetry retrying idempotent GET
      fetchSpy.mockResolvedValue(mockNonJsonResponse(400));

      await expect(getItem("abc")).rejects.toThrow("Request failed");
    });
  });

  // --- API Wrappers ---

  describe("API wrapper functions", () => {
    it("listItems constructs correct URL with query params", async () => {
      const { listItems } = await import("@/lib/api");
      fetchSpy.mockResolvedValue(mockResponse(200, { items: [], total: 0 }));

      await listItems({ status: "fleeting", tag: "idea" });

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("/api/items?");
      expect(url).toContain("status=fleeting");
      expect(url).toContain("tag=idea");
    });

    it("createItem sends POST with JSON body", async () => {
      const { createItem } = await import("@/lib/api");
      fetchSpy.mockResolvedValue(mockResponse(200, { id: "new-1", title: "test" }));

      await createItem({ title: "test" });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/items");
      expect(opts.method).toBe("POST");
      expect(opts.body).toBe(JSON.stringify({ title: "test" }));
    });

    it("updateItem sends PATCH with correct URL and body", async () => {
      const { updateItem } = await import("@/lib/api");
      fetchSpy.mockResolvedValue(mockResponse(200, { id: "item-1", title: "updated" }));

      await updateItem("item-1", { title: "updated" });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/items/item-1");
      expect(opts.method).toBe("PATCH");
      expect(opts.body).toBe(JSON.stringify({ title: "updated" }));
    });

    it("deleteItem sends DELETE with correct URL", async () => {
      const { deleteItem } = await import("@/lib/api");
      fetchSpy.mockResolvedValue(mockResponse(200, {}));

      await deleteItem("item-1");

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/items/item-1");
      expect(opts.method).toBe("DELETE");
    });
  });
});
