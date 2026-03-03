import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "../use-online-status";

let originalOnLine: boolean;
let originalVisibilityState: string;

beforeEach(() => {
  originalOnLine = navigator.onLine;
  originalVisibilityState = document.visibilityState;
});

afterEach(() => {
  Object.defineProperty(navigator, "onLine", {
    value: originalOnLine,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(document, "visibilityState", {
    value: originalVisibilityState,
    writable: true,
    configurable: true,
  });
});

function setOnlineStatus(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    value: online,
    writable: true,
    configurable: true,
  });
}

describe("useOnlineStatus", () => {
  it("returns true when navigator.onLine is true", () => {
    setOnlineStatus(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("returns false when navigator.onLine is false", () => {
    setOnlineStatus(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it("updates to false on offline event", () => {
    setOnlineStatus(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
  });

  it("updates to true on online event", () => {
    setOnlineStatus(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

  it("cleans up event listeners on unmount", () => {
    setOnlineStatus(true);
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const docAddSpy = vi.spyOn(document, "addEventListener");
    const docRemoveSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => useOnlineStatus());

    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("offline", expect.any(Function));
    expect(docAddSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));
    expect(docRemoveSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
    docAddSpy.mockRestore();
    docRemoveSpy.mockRestore();
  });

  it("re-syncs to online when page becomes visible and navigator.onLine is true", () => {
    setOnlineStatus(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);

    // Simulate: phone reconnects while backgrounded, navigator.onLine updates
    setOnlineStatus(true);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(true);
  });

  it("re-syncs to offline when page becomes visible and navigator.onLine is false", () => {
    setOnlineStatus(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    // Simulate: connection lost while backgrounded
    setOnlineStatus(false);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(false);
  });

  it("does not update when page becomes hidden", () => {
    setOnlineStatus(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    setOnlineStatus(false);

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should NOT update — only re-sync when becoming visible
    expect(result.current).toBe(true);
  });
});
