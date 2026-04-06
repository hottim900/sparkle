import { describe, it, expect, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleConfirmDialog, isAutoTitle } from "../title-confirm-dialog";
import { renderWithContext } from "@/test-utils";

// ============================================================
// isAutoTitle unit tests
// ============================================================
describe("isAutoTitle", () => {
  it("matches when title equals first line", () => {
    expect(isAutoTitle("First line", "First line\nSecond line")).toBe(true);
  });

  it("matches when title equals truncated first line with ...", () => {
    const long = "A".repeat(100);
    expect(isAutoTitle("A".repeat(80) + "...", long)).toBe(true);
  });

  it("does not match when title differs", () => {
    expect(isAutoTitle("Custom title", "First line\nSecond line")).toBe(false);
  });

  it("does not match when content is empty", () => {
    expect(isAutoTitle("Some title", "")).toBe(false);
  });

  it("does not match when content is null", () => {
    expect(isAutoTitle("Some title", null)).toBe(false);
  });

  it("skips empty first line and matches second", () => {
    expect(isAutoTitle("Actual content", "\nActual content")).toBe(true);
  });

  it("handles whitespace trimming", () => {
    expect(isAutoTitle("padded", "  padded  \nMore")).toBe(true);
  });

  it("matches exactly 80 chars (no ...)", () => {
    const exact = "B".repeat(80);
    expect(isAutoTitle(exact, exact + "\nMore")).toBe(true);
  });
});

// ============================================================
// TitleConfirmDialog component tests
// ============================================================
describe("TitleConfirmDialog", () => {
  it("shows modal with pre-filled title when open", async () => {
    renderWithContext(
      <TitleConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        currentTitle="Auto title"
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Auto title")).toBeInTheDocument();
    });
    expect(screen.getByText("確認標題")).toBeInTheDocument();
  });

  it("calls onConfirm with original title on confirm without edit", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithContext(
      <TitleConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        currentTitle="Auto title"
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("確認推進")).toBeInTheDocument();
    });
    await user.click(screen.getByText("確認推進"));
    expect(onConfirm).toHaveBeenCalledWith("Auto title");
  });

  it("calls onConfirm with edited title", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithContext(
      <TitleConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        currentTitle="Auto title"
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Auto title")).toBeInTheDocument();
    });
    const input = screen.getByDisplayValue("Auto title");
    await user.clear(input);
    await user.type(input, "Better title");
    await user.click(screen.getByText("確認推進"));
    expect(onConfirm).toHaveBeenCalledWith("Better title");
  });

  it("calls onOpenChange(false) on cancel", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithContext(
      <TitleConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        currentTitle="Auto title"
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("取消")).toBeInTheDocument();
    });
    await user.click(screen.getByText("取消"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("confirm button disabled with empty title", async () => {
    const user = userEvent.setup();
    renderWithContext(
      <TitleConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        currentTitle="Auto title"
        onConfirm={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Auto title")).toBeInTheDocument();
    });
    const input = screen.getByDisplayValue("Auto title");
    await user.clear(input);
    expect(screen.getByText("確認推進")).toBeDisabled();
  });

  it("Enter key in input triggers confirm", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    renderWithContext(
      <TitleConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        currentTitle="Auto title"
        onConfirm={onConfirm}
      />,
    );
    await waitFor(() => {
      expect(screen.getByDisplayValue("Auto title")).toBeInTheDocument();
    });
    const input = screen.getByDisplayValue("Auto title");
    await user.click(input);
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledWith("Auto title");
  });
});
