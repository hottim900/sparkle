import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithContext } from "@/test-utils";
import * as api from "@/lib/api";

vi.mock("@/lib/api");

let mockSearchParams: Record<string, string | undefined> = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: { component: React.FC }) => ({
    ...opts,
  }),
  useSearch: () => mockSearchParams,
}));

import { Route } from "@/routes/vault";

const VaultPage = Route.component!;

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams = {};
  vi.mocked(api.searchVault).mockResolvedValue({
    results: [
      {
        path: "notes/hello.md",
        title: "Hello World",
        mtime: Date.now(),
      },
    ],
    total: 1,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("VaultPage", () => {
  it("?file= auto-selects file and shows content", async () => {
    mockSearchParams = { file: "notes/hello.md" };

    vi.mocked(api.getVaultFile).mockResolvedValue({
      path: "notes/hello.md",
      title: "Hello World",
      frontmatter: null,
      content: "# Hello\n\nThis is vault content.",
      mtime: Date.now(),
    });

    renderWithContext(<VaultPage />);

    // Should load the file content via getVaultFile
    await waitFor(() => {
      expect(api.getVaultFile).toHaveBeenCalledWith("notes/hello.md");
    });

    // Rendered markdown content should be visible
    await waitFor(() => {
      expect(screen.getByText("This is vault content.")).toBeInTheDocument();
    });
  });

  it("404 file shows error message", async () => {
    mockSearchParams = { file: "nonexistent/file.md" };

    vi.mocked(api.getVaultFile).mockRejectedValue(new Error("Not Found"));

    renderWithContext(<VaultPage />);

    // Should show error message for missing file
    await waitFor(() => {
      expect(screen.getByText("此檔案已不存在於 Vault 中")).toBeInTheDocument();
    });

    // Should show a back button
    expect(screen.getByText("返回列表")).toBeInTheDocument();
  });
});
