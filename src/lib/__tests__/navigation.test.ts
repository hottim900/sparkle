import { describe, it, expect } from "vitest";
import { viewToPath, pathToView, isListRoute } from "../navigation";

describe("viewToPath", () => {
  it("maps known views to paths", () => {
    expect(viewToPath("dashboard")).toBe("/dashboard");
    expect(viewToPath("fleeting")).toBe("/notes/fleeting");
    expect(viewToPath("developing")).toBe("/notes/developing");
    expect(viewToPath("permanent")).toBe("/notes/permanent");
    expect(viewToPath("exported")).toBe("/notes/exported");
    expect(viewToPath("active")).toBe("/todos");
    expect(viewToPath("done")).toBe("/todos/done");
    expect(viewToPath("draft")).toBe("/scratch");
    expect(viewToPath("all")).toBe("/all");
    expect(viewToPath("archived")).toBe("/archived");
    expect(viewToPath("settings")).toBe("/settings");
    expect(viewToPath("shares")).toBe("/shares");
  });

  it("maps aggregate views to their defaults", () => {
    expect(viewToPath("notes")).toBe("/notes/fleeting");
    expect(viewToPath("todos")).toBe("/todos");
    expect(viewToPath("scratch")).toBe("/scratch");
  });

  it("returns / for unknown views", () => {
    expect(viewToPath("nonexistent")).toBe("/");
  });
});

describe("pathToView", () => {
  it("maps known paths to views", () => {
    expect(pathToView("/dashboard")).toBe("dashboard");
    expect(pathToView("/notes/fleeting")).toBe("fleeting");
    expect(pathToView("/todos")).toBe("active");
    expect(pathToView("/todos/done")).toBe("done");
    expect(pathToView("/scratch")).toBe("draft");
    expect(pathToView("/all")).toBe("all");
    expect(pathToView("/archived")).toBe("archived");
  });

  it("returns undefined for unknown paths", () => {
    expect(pathToView("/unknown")).toBeUndefined();
    expect(pathToView("/")).toBeUndefined();
  });
});

describe("isListRoute", () => {
  it("identifies list routes", () => {
    expect(isListRoute("/notes/fleeting")).toBe(true);
    expect(isListRoute("/notes/developing")).toBe(true);
    expect(isListRoute("/todos")).toBe(true);
    expect(isListRoute("/todos/done")).toBe(true);
    expect(isListRoute("/scratch")).toBe(true);
    expect(isListRoute("/all")).toBe(true);
    expect(isListRoute("/archived")).toBe(true);
  });

  it("rejects non-list routes", () => {
    expect(isListRoute("/dashboard")).toBe(false);
    expect(isListRoute("/settings")).toBe(false);
    expect(isListRoute("/shares")).toBe(false);
    expect(isListRoute("/")).toBe(false);
  });
});
