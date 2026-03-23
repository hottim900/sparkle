import { renderHook, act, cleanup } from "@testing-library/react";
import { usePrivateLock } from "../use-private-lock";

// --- Setup ---

let originalVisibilityState: string;

beforeEach(() => {
  originalVisibilityState = document.visibilityState;
  vi.useFakeTimers();
  vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true }))),
  );
  localStorage.setItem("auth_token", "test-auth-token");
});

afterEach(() => {
  // Unmount hooks BEFORE restoring mocks, so cleanup effects
  // (fireLock on unmount) still use the mocked fetch.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
  localStorage.clear();
});

function setVisibilityState(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
}

function fireVisibilityChange(state: "visible" | "hidden") {
  setVisibilityState(state);
  document.dispatchEvent(new Event("visibilitychange"));
}

// --- Tests ---

describe("usePrivateLock", () => {
  // === Group 1: Initialization ===

  describe("initialization", () => {
    it("returns overlayVisible=false by default", () => {
      const { result } = renderHook(() => usePrivateLock({ sessionToken: "tok", onLock: vi.fn() }));
      expect(result.current.overlayVisible).toBe(false);
    });

    it("does not attach listeners when sessionToken is null", () => {
      const addSpy = vi.spyOn(document, "addEventListener");
      const winAddSpy = vi.spyOn(window, "addEventListener");

      renderHook(() => usePrivateLock({ sessionToken: null, onLock: vi.fn() }));

      expect(addSpy).not.toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      expect(winAddSpy).not.toHaveBeenCalledWith("blur", expect.any(Function));
      expect(addSpy).not.toHaveBeenCalledWith(
        "pointerdown",
        expect.any(Function),
        expect.anything(),
      );

      addSpy.mockRestore();
      winAddSpy.mockRestore();
    });
  });

  // === Group 2: Visibility trigger ===

  describe("visibilitychange trigger", () => {
    it("shows overlay and calls onLock when page becomes hidden", () => {
      const onLock = vi.fn();
      const { result } = renderHook(() => usePrivateLock({ sessionToken: "tok", onLock }));

      act(() => fireVisibilityChange("hidden"));

      expect(result.current.overlayVisible).toBe(true);
      expect(onLock).toHaveBeenCalledOnce();
    });

    it("fires lock API with keepalive", () => {
      renderHook(() => usePrivateLock({ sessionToken: "tok", onLock: vi.fn() }));

      act(() => fireVisibilityChange("hidden"));

      expect(fetch).toHaveBeenCalledWith("/api/private/lock", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-auth-token",
          "X-Private-Token": "tok",
        },
        keepalive: true,
      });
    });

    it("does not trigger on visibilityState=visible", () => {
      const onLock = vi.fn();
      renderHook(() => usePrivateLock({ sessionToken: "tok", onLock }));

      act(() => fireVisibilityChange("visible"));

      expect(onLock).not.toHaveBeenCalled();
    });

    it("prevents double-lock on rapid visibility changes", () => {
      const onLock = vi.fn();
      renderHook(() => usePrivateLock({ sessionToken: "tok", onLock }));

      act(() => {
        fireVisibilityChange("hidden");
        fireVisibilityChange("hidden");
      });

      expect(onLock).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  // === Group 3: Blur/focus trigger ===

  describe("blur/focus trigger", () => {
    it("shows overlay after blur grace period", () => {
      const { result } = renderHook(() =>
        usePrivateLock({
          sessionToken: "tok",
          onLock: vi.fn(),
          blurGraceMs: 200,
        }),
      );

      act(() => window.dispatchEvent(new Event("blur")));
      expect(result.current.overlayVisible).toBe(false);

      act(() => vi.advanceTimersByTime(200));
      expect(result.current.overlayVisible).toBe(true);
    });

    it("cancels overlay if focus returns within grace period", () => {
      const { result } = renderHook(() =>
        usePrivateLock({
          sessionToken: "tok",
          onLock: vi.fn(),
          blurGraceMs: 200,
        }),
      );

      act(() => window.dispatchEvent(new Event("blur")));
      act(() => vi.advanceTimersByTime(100));
      act(() => window.dispatchEvent(new Event("focus")));
      act(() => vi.advanceTimersByTime(200));

      expect(result.current.overlayVisible).toBe(false);
    });

    it("hides overlay on focus when blur-only overlay was shown", () => {
      const onLock = vi.fn();
      const { result } = renderHook(() =>
        usePrivateLock({
          sessionToken: "tok",
          onLock,
          blurGraceMs: 200,
        }),
      );

      act(() => window.dispatchEvent(new Event("blur")));
      act(() => vi.advanceTimersByTime(200));
      expect(result.current.overlayVisible).toBe(true);

      act(() => window.dispatchEvent(new Event("focus")));
      expect(result.current.overlayVisible).toBe(false);
      expect(onLock).not.toHaveBeenCalled();
    });

    it("does NOT call onLock on blur", () => {
      const onLock = vi.fn();
      renderHook(() =>
        usePrivateLock({
          sessionToken: "tok",
          onLock,
          blurGraceMs: 200,
        }),
      );

      act(() => window.dispatchEvent(new Event("blur")));
      act(() => vi.advanceTimersByTime(200));

      expect(onLock).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("skips blur handler when already locked by visibilitychange", () => {
      const { result } = renderHook(() =>
        usePrivateLock({
          sessionToken: "tok",
          onLock: vi.fn(),
          blurGraceMs: 200,
        }),
      );

      // Lock via visibilitychange first
      act(() => fireVisibilityChange("hidden"));
      expect(result.current.overlayVisible).toBe(true);

      // blur should be no-op (lockedRef is true)
      act(() => window.dispatchEvent(new Event("blur")));
      act(() => vi.advanceTimersByTime(200));

      // onLock and fetch should have been called exactly once (from visibility)
      expect(fetch).toHaveBeenCalledOnce();
    });
  });

  // === Group 4: Idle timer ===

  describe("idle timer", () => {
    const IDLE_MS = 5 * 60 * 1000; // 5 min default

    it("locks after idle timeout expires", () => {
      const onLock = vi.fn();
      const { result } = renderHook(() => usePrivateLock({ sessionToken: "tok", onLock }));

      act(() => vi.advanceTimersByTime(IDLE_MS));

      expect(result.current.overlayVisible).toBe(true);
      expect(onLock).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    });

    it("resets idle timer on user activity", () => {
      const onLock = vi.fn();
      renderHook(() => usePrivateLock({ sessionToken: "tok", onLock }));

      // Advance 4 min, then activity
      act(() => vi.advanceTimersByTime(4 * 60 * 1000));
      act(() => document.dispatchEvent(new Event("pointerdown")));

      // Advance another 4 min — should NOT have locked (timer reset)
      act(() => vi.advanceTimersByTime(4 * 60 * 1000));
      expect(onLock).not.toHaveBeenCalled();

      // Advance 1 more min (total 5 after last activity) — should lock
      act(() => vi.advanceTimersByTime(1 * 60 * 1000));
      expect(onLock).toHaveBeenCalledOnce();
    });

    it("throttles timer resets (ignores activity within 30s)", () => {
      const onLock = vi.fn();
      renderHook(() => usePrivateLock({ sessionToken: "tok", onLock }));

      // t=10s: keydown — should be throttled (< 30s since mount)
      act(() => vi.advanceTimersByTime(10_000));
      act(() => document.dispatchEvent(new Event("keydown")));

      // t=31s: keydown — should reset timer (>= 30s since last reset at t=0)
      act(() => vi.advanceTimersByTime(21_000));
      act(() => document.dispatchEvent(new Event("keydown")));

      // Timer resets at t=31s → lock at t=31s + 5min = t=331s
      // Advance to t=31s + 4min59s = t=330s — should NOT be locked
      act(() => vi.advanceTimersByTime(4 * 60 * 1000 + 59_000));
      expect(onLock).not.toHaveBeenCalled();

      // Advance 1 more second to t=331s — should lock
      act(() => vi.advanceTimersByTime(1_000));
      expect(onLock).toHaveBeenCalledOnce();
    });

    it("accepts custom idle timeout", () => {
      const onLock = vi.fn();
      renderHook(() =>
        usePrivateLock({
          sessionToken: "tok",
          onLock,
          idleTimeoutMs: 60_000,
        }),
      );

      act(() => vi.advanceTimersByTime(59_999));
      expect(onLock).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(onLock).toHaveBeenCalledOnce();
    });
  });

  // === Group 5: Unmount ===

  describe("unmount", () => {
    it("fires lock API on unmount when token is set", () => {
      const { unmount } = renderHook(() =>
        usePrivateLock({ sessionToken: "tok", onLock: vi.fn() }),
      );

      unmount();

      expect(fetch).toHaveBeenCalledWith(
        "/api/private/lock",
        expect.objectContaining({ keepalive: true }),
      );
    });

    it("does NOT fire lock API on unmount when token is null", () => {
      const { unmount } = renderHook(() => usePrivateLock({ sessionToken: null, onLock: vi.fn() }));

      unmount();

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  // === Group 6: Cleanup ===

  describe("cleanup", () => {
    it("removes all event listeners on unmount", () => {
      const docRemoveSpy = vi.spyOn(document, "removeEventListener");
      const winRemoveSpy = vi.spyOn(window, "removeEventListener");

      const { unmount } = renderHook(() =>
        usePrivateLock({ sessionToken: "tok", onLock: vi.fn() }),
      );

      unmount();

      expect(docRemoveSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      expect(docRemoveSpy).toHaveBeenCalledWith("pointerdown", expect.any(Function));
      expect(docRemoveSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
      expect(docRemoveSpy).toHaveBeenCalledWith("scroll", expect.any(Function));
      expect(winRemoveSpy).toHaveBeenCalledWith("blur", expect.any(Function));
      expect(winRemoveSpy).toHaveBeenCalledWith("focus", expect.any(Function));

      docRemoveSpy.mockRestore();
      winRemoveSpy.mockRestore();
    });

    it("clears idle timer on unmount", () => {
      const clearSpy = vi.spyOn(globalThis, "clearTimeout");

      const { unmount } = renderHook(() =>
        usePrivateLock({ sessionToken: "tok", onLock: vi.fn() }),
      );

      unmount();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it("re-registers listeners when sessionToken changes from null to string", () => {
      const docAddSpy = vi.spyOn(document, "addEventListener");

      const { rerender } = renderHook(
        ({ token }) => usePrivateLock({ sessionToken: token, onLock: vi.fn() }),
        { initialProps: { token: null as string | null } },
      );

      docAddSpy.mockClear();
      rerender({ token: "new-tok" });

      expect(docAddSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
      expect(docAddSpy).toHaveBeenCalledWith(
        "pointerdown",
        expect.any(Function),
        expect.objectContaining({ passive: true }),
      );

      docAddSpy.mockRestore();
    });
  });

  // === Group 7: clearOverlay ===

  describe("clearOverlay", () => {
    it("resets overlayVisible to false", () => {
      const { result } = renderHook(() => usePrivateLock({ sessionToken: "tok", onLock: vi.fn() }));

      // Trigger lock to show overlay
      act(() => fireVisibilityChange("hidden"));
      expect(result.current.overlayVisible).toBe(true);

      act(() => result.current.clearOverlay());
      expect(result.current.overlayVisible).toBe(false);
    });

    it("allows re-locking after clearOverlay + new token", () => {
      const onLock = vi.fn();
      const { result, rerender } = renderHook(
        ({ token }) => usePrivateLock({ sessionToken: token, onLock }),
        { initialProps: { token: "tok1" as string | null } },
      );

      // Lock
      act(() => fireVisibilityChange("hidden"));
      expect(onLock).toHaveBeenCalledOnce();

      // Simulate re-unlock: parent clears token, then sets new one
      rerender({ token: null });
      act(() => result.current.clearOverlay());
      rerender({ token: "tok2" });

      // Re-set to visible for next test
      act(() => {
        setVisibilityState("visible");
      });

      // Should be able to lock again
      act(() => fireVisibilityChange("hidden"));
      expect(onLock).toHaveBeenCalledTimes(2);
    });
  });
});
