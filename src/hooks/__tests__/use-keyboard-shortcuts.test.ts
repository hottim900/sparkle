import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../use-keyboard-shortcuts";

function pressKey(key: string) {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("useKeyboardShortcuts", () => {
  let handlers: {
    onNewItem: ReturnType<typeof vi.fn>;
    onSearch: ReturnType<typeof vi.fn>;
    onClose: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {
      onNewItem: vi.fn(),
      onSearch: vi.fn(),
      onClose: vi.fn(),
    };
  });

  it('pressing "n" calls onNewItem', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    pressKey("n");
    expect(handlers.onNewItem).toHaveBeenCalledOnce();
  });

  it('pressing "/" calls onSearch', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    pressKey("/");
    expect(handlers.onSearch).toHaveBeenCalledOnce();
  });

  it('pressing "Escape" calls onClose', () => {
    renderHook(() => useKeyboardShortcuts(handlers));
    pressKey("Escape");
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it("ignores shortcuts when INPUT is focused", () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    pressKey("n");
    pressKey("/");
    expect(handlers.onNewItem).not.toHaveBeenCalled();
    expect(handlers.onSearch).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("ignores shortcuts when TEXTAREA is focused", () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();

    pressKey("n");
    pressKey("/");
    expect(handlers.onNewItem).not.toHaveBeenCalled();
    expect(handlers.onSearch).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it("ignores shortcuts when SELECT is focused", () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const select = document.createElement("select");
    document.body.appendChild(select);
    select.focus();

    pressKey("n");
    expect(handlers.onNewItem).not.toHaveBeenCalled();

    document.body.removeChild(select);
  });

  it("pressing Escape in a focused input blurs the element", () => {
    renderHook(() => useKeyboardShortcuts(handlers));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    pressKey("Escape");
    expect(document.activeElement).not.toBe(input);
    // onClose should NOT be called because input was focused
    expect(handlers.onClose).not.toHaveBeenCalled();

    document.body.removeChild(input);
  });

  it("cleans up event listener on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(handlers));
    unmount();

    pressKey("n");
    expect(handlers.onNewItem).not.toHaveBeenCalled();
  });
});
