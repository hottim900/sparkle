import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthGate } from "../auth-gate";

const mockHasToken = vi.fn();
const mockSetToken = vi.fn();

vi.mock("@/lib/api", () => ({
  hasToken: (...args: unknown[]) => mockHasToken(...args),
  setToken: (...args: unknown[]) => mockSetToken(...args),
}));

describe("AuthGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders children when already authenticated", () => {
    mockHasToken.mockReturnValue(true);
    render(
      <AuthGate>
        <div>App Content</div>
      </AuthGate>,
    );
    expect(screen.getByText("App Content")).toBeInTheDocument();
  });

  it("shows login form when not authenticated", () => {
    mockHasToken.mockReturnValue(false);
    render(
      <AuthGate>
        <div>App Content</div>
      </AuthGate>,
    );
    expect(screen.queryByText("App Content")).not.toBeInTheDocument();
    expect(screen.getByText("Sparkle")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("存取權杖")).toBeInTheDocument();
  });

  it("shows token input with password type", () => {
    mockHasToken.mockReturnValue(false);
    render(
      <AuthGate>
        <div />
      </AuthGate>,
    );
    const input = screen.getByPlaceholderText("存取權杖");
    expect(input).toHaveAttribute("type", "password");
  });

  it("shows error when submitting empty token", async () => {
    mockHasToken.mockReturnValue(false);
    const user = userEvent.setup();
    render(
      <AuthGate>
        <div />
      </AuthGate>,
    );

    await user.click(screen.getByRole("button", { name: "登入" }));

    expect(screen.getByText("請輸入存取權杖")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls setToken and renders children on successful login", async () => {
    mockHasToken.mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);

    const user = userEvent.setup();
    render(
      <AuthGate>
        <div>App Content</div>
      </AuthGate>,
    );

    await user.type(screen.getByPlaceholderText("存取權杖"), "my-secret-token");
    await user.click(screen.getByRole("button", { name: "登入" }));

    await waitFor(() => {
      expect(screen.getByText("App Content")).toBeInTheDocument();
    });
    expect(mockSetToken).toHaveBeenCalledWith("my-secret-token");
    expect(fetch).toHaveBeenCalledWith("/api/items?limit=1", {
      headers: { Authorization: "Bearer my-secret-token" },
    });
  });

  it("shows error message on invalid token (401)", async () => {
    mockHasToken.mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 401 } as Response);

    const user = userEvent.setup();
    render(
      <AuthGate>
        <div />
      </AuthGate>,
    );

    await user.type(screen.getByPlaceholderText("存取權杖"), "bad-token");
    await user.click(screen.getByRole("button", { name: "登入" }));

    await waitFor(() => {
      expect(screen.getByText("權杖無效")).toBeInTheDocument();
    });
    expect(mockSetToken).not.toHaveBeenCalled();
  });

  it("shows error on network failure", async () => {
    mockHasToken.mockReturnValue(false);
    vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

    const user = userEvent.setup();
    render(
      <AuthGate>
        <div />
      </AuthGate>,
    );

    await user.type(screen.getByPlaceholderText("存取權杖"), "some-token");
    await user.click(screen.getByRole("button", { name: "登入" }));

    await waitFor(() => {
      expect(screen.getByText("無法連線到伺服器")).toBeInTheDocument();
    });
  });

  it("shows loading state during submit", async () => {
    mockHasToken.mockReturnValue(false);
    // Never-resolving promise to keep loading state
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}));

    const user = userEvent.setup();
    render(
      <AuthGate>
        <div />
      </AuthGate>,
    );

    await user.type(screen.getByPlaceholderText("存取權杖"), "token");
    await user.click(screen.getByRole("button", { name: "登入" }));

    expect(screen.getByRole("button", { name: "驗證中..." })).toBeDisabled();
  });
});
