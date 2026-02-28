import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "../error-boundary";

let shouldThrow = false;

function ProblemChild() {
  if (shouldThrow) throw new Error("Test error");
  return <div>Child content</div>;
}

// Suppress console.error for expected errors in ErrorBoundary tests
beforeEach(() => {
  shouldThrow = false;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Normal content</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Normal content")).toBeInTheDocument();
  });

  it("renders error fallback when child throws", () => {
    shouldThrow = true;
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText("載入元件時發生錯誤")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新載入" })).toBeInTheDocument();
  });

  it("recovers when retry button is clicked after error is fixed", async () => {
    const user = userEvent.setup();
    shouldThrow = true;

    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("載入元件時發生錯誤")).toBeInTheDocument();

    // Fix the error condition before clicking retry
    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "重新載入" }));

    // After clicking retry, ErrorBoundary resets hasError to false,
    // and ProblemChild now renders successfully
    expect(screen.getByText("Child content")).toBeInTheDocument();
  });
});
