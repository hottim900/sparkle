import { fetchWithRetry, ApiClientError } from "@/lib/api";

// Helper to create a mock Response
function mockResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchWithRetry", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  // Fake timers + rejected promises produce spurious unhandled rejection errors
  // when timer advancement and promise scheduling overlap. The rejections ARE
  // caught by fetchWithRetry's try/catch — suppress the false-positive errors.
  const noop = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    process.on("unhandledRejection", noop);
  });

  afterEach(() => {
    process.removeListener("unhandledRejection", noop);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- Timeout ---

  it("returns response when request completes within timeout", async () => {
    fetchSpy.mockResolvedValue(mockResponse(200, { ok: true }));

    const res = await fetchWithRetry("/api/test");

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws ApiClientError with status 0 on timeout", async () => {
    fetchSpy.mockImplementation(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ message: "Request timed out", status: 0 });
  });

  // --- Retry on network errors ---

  it("retries GET on network error then succeeds", async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse(200));

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries POST on network error (request never reached server)", async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(mockResponse(200));

    const promise = fetchWithRetry("/api/test", { method: "POST" });
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after MAX_ATTEMPTS network errors", async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("Failed to fetch");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retries on timeout then succeeds on second attempt", async () => {
    // First attempt: times out
    fetchSpy.mockImplementationOnce(
      (_url: string, opts: RequestInit) =>
        new Promise((_resolve, reject) => {
          opts.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    // Second attempt: succeeds
    fetchSpy.mockResolvedValueOnce(mockResponse(200));

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // --- Retry on 5xx for idempotent methods ---

  it("retries GET on 500 response", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(500)).mockResolvedValueOnce(mockResponse(200));

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries DELETE on 502 response", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(502)).mockResolvedValueOnce(mockResponse(200));

    const promise = fetchWithRetry("/api/test", { method: "DELETE" });
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // --- No retry on 5xx for non-idempotent methods ---

  it("does NOT retry POST on 500 response", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(500));

    const res = await fetchWithRetry("/api/test", { method: "POST" });

    expect(res.status).toBe(500);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry PATCH on 503 response", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(503));

    const res = await fetchWithRetry("/api/test", { method: "PATCH" });

    expect(res.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // --- No retry on 4xx ---

  it("does NOT retry on 400 Bad Request", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(400));

    const res = await fetchWithRetry("/api/test");

    expect(res.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 401 Unauthorized", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(401));

    const res = await fetchWithRetry("/api/test");

    expect(res.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on 404 Not Found", async () => {
    fetchSpy.mockResolvedValueOnce(mockResponse(404));

    const res = await fetchWithRetry("/api/test");

    expect(res.status).toBe(404);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // --- Backoff ---

  it("applies exponential backoff between retries", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0); // jitter = 0
    fetchSpy
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const promise = fetchWithRetry("/api/test");
    await vi.runAllTimersAsync();
    await promise.catch(() => {}); // consume rejection

    // Filter for backoff delays (exclude the 15s timeout calls)
    const backoffCalls = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((ms): ms is number => typeof ms === "number" && ms > 0 && ms < 15_000);

    // Should have 2 backoff delays: ~1000ms and ~2000ms
    expect(backoffCalls).toHaveLength(2);
    expect(backoffCalls[0]).toBe(1000); // BASE_DELAY * 2^0 + 0 jitter
    expect(backoffCalls[1]).toBe(2000); // BASE_DELAY * 2^1 + 0 jitter
  });

  // --- Options passthrough ---

  it("passes request options to fetch", async () => {
    fetchSpy.mockResolvedValue(mockResponse(200));

    await fetchWithRetry("/api/test", {
      method: "POST",
      headers: { "X-Custom": "value" },
      body: "test-body",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        method: "POST",
        headers: { "X-Custom": "value" },
        body: "test-body",
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
