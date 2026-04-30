import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AnnouncementProvider, useAnnouncement } from "../announcement-provider";

function Announcer({ message }: { message: string }) {
  const announce = useAnnouncement();
  return (
    <button type="button" onClick={() => announce(message)}>
      announce
    </button>
  );
}

describe("AnnouncementProvider", () => {
  it("renders the sr-only live region near children", () => {
    render(
      <AnnouncementProvider>
        <div>app</div>
      </AnnouncementProvider>,
    );
    const region = document.querySelector("[role='status']");
    expect(region).toBeTruthy();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.className).toContain("sr-only");
  });

  it("publishes announce() updates to the live region", async () => {
    render(
      <AnnouncementProvider>
        <Announcer message="vault 路徑已更新" />
      </AnnouncementProvider>,
    );

    const button = screen.getByRole("button", { name: "announce" });
    await act(async () => {
      button.click();
      // the provider toggles "" then schedules a rAF; flush.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });

    const region = document.querySelector("[role='status']");
    expect(region?.textContent).toBe("vault 路徑已更新");
  });

  it("re-fires identical announcements (toggles via empty + rAF)", async () => {
    render(
      <AnnouncementProvider>
        <Announcer message="vault 路徑已更新" />
      </AnnouncementProvider>,
    );

    const button = screen.getByRole("button", { name: "announce" });
    const region = document.querySelector("[role='status']");

    await act(async () => {
      button.click();
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    expect(region?.textContent).toBe("vault 路徑已更新");

    // Same string twice — must clear, then re-set, so screen readers
    // re-announce. Verify by observing the empty interim.
    await act(async () => {
      button.click();
    });
    expect(region?.textContent).toBe("");

    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    expect(region?.textContent).toBe("vault 路徑已更新");
  });

  it("useAnnouncement returns a no-op outside the provider (no throw)", () => {
    function Bare() {
      const announce = useAnnouncement();
      // Calling announce should not throw even without a provider.
      expect(() => announce("test")).not.toThrow();
      return <div>ok</div>;
    }
    render(<Bare />);
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
