import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "../use-online-status";

let originalOnLine: boolean;

beforeEach(() => {
  originalOnLine = navigator.onLine;
});

afterEach(() => {
  Object.defineProperty(navigator, "onLine", {
    value: originalOnLine,
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

    const { unmount } = renderHook(() => useOnlineStatus());

    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("offline", expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
