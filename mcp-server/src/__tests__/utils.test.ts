import { describe, it, expect } from "vitest";
import { formatToolError } from "../utils.js";
import { SparkleApiError } from "../client.js";

describe("formatToolError", () => {
  it("formats SparkleApiError with HTTP status", () => {
    const error = new SparkleApiError("Not Found", 404);
    const result = formatToolError(error);
    expect(result).toEqual({
      content: [{ type: "text", text: "Error (HTTP 404): Not Found" }],
      isError: true,
    });
  });

  it("formats generic Error", () => {
    const error = new Error("Something went wrong");
    const result = formatToolError(error);
    expect(result).toEqual({
      content: [{ type: "text", text: "Error: Something went wrong" }],
      isError: true,
    });
  });

  it("formats non-Error values", () => {
    const result = formatToolError("string error");
    expect(result).toEqual({
      content: [{ type: "text", text: "Error: string error" }],
      isError: true,
    });
  });
});
