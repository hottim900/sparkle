import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallPrompt, setDeferredPrompt } from "../install-prompt";

function makeDeferredPrompt() {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome: "accepted" as const }),
    preventDefault: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the module-level deferredPrompt
  setDeferredPrompt(null as unknown as Parameters<typeof setDeferredPrompt>[0]);
});

describe("InstallPrompt", () => {
  it("renders nothing when no install prompt available", () => {
    const { container } = render(<InstallPrompt />);
    expect(container.innerHTML).toBe("");
  });

  it("shows install banner when deferredPrompt is set before mount", () => {
    const prompt = makeDeferredPrompt();
    setDeferredPrompt(prompt as unknown as Parameters<typeof setDeferredPrompt>[0]);

    render(<InstallPrompt />);
    expect(screen.getByText("安裝")).toBeInTheDocument();
    expect(screen.getByText(/安裝到主畫面/)).toBeInTheDocument();
  });

  it("shows install banner when pwa-install-available event fires", () => {
    render(<InstallPrompt />);
    expect(screen.queryByText("安裝")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event("pwa-install-available"));
    });

    expect(screen.getByText("安裝")).toBeInTheDocument();
  });

  it("clicking 安裝 calls prompt()", async () => {
    const user = userEvent.setup();
    const prompt = makeDeferredPrompt();
    setDeferredPrompt(prompt as unknown as Parameters<typeof setDeferredPrompt>[0]);

    render(<InstallPrompt />);

    await user.click(screen.getByText("安裝"));
    expect(prompt.prompt).toHaveBeenCalled();
  });

  it("clicking dismiss hides the banner", async () => {
    const user = userEvent.setup();
    const prompt = makeDeferredPrompt();
    prompt.userChoice = Promise.resolve({ outcome: "dismissed" as const });
    setDeferredPrompt(prompt as unknown as Parameters<typeof setDeferredPrompt>[0]);

    render(<InstallPrompt />);
    expect(screen.getByText(/安裝到主畫面/)).toBeInTheDocument();

    // Click the X button (ghost variant, icon-sm size)
    const buttons = screen.getAllByRole("button");
    const dismissButton = buttons.find((btn) => btn.textContent !== "安裝")!;
    await user.click(dismissButton);

    expect(screen.queryByText(/安裝到主畫面/)).not.toBeInTheDocument();
  });
});
