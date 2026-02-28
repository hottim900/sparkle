import { render, screen, act } from "@testing-library/react";
import { OfflineIndicator } from "../offline-indicator";

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

describe("OfflineIndicator", () => {
  it("renders nothing when online", () => {
    setOnlineStatus(true);
    const { container } = render(<OfflineIndicator />);
    expect(container.innerHTML).toBe("");
  });

  it("shows offline indicator when offline", () => {
    setOnlineStatus(false);
    render(<OfflineIndicator />);
    expect(screen.getByText("離線模式")).toBeInTheDocument();
  });

  it("responds to online/offline events", () => {
    setOnlineStatus(true);
    render(<OfflineIndicator />);
    expect(screen.queryByText("離線模式")).not.toBeInTheDocument();

    // Go offline
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByText("離線模式")).toBeInTheDocument();

    // Come back online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByText("離線模式")).not.toBeInTheDocument();
  });
});
