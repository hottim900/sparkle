import { describe, it, expect } from "vitest";
import { rootSearchSchema, listSearchSchema } from "../search-params";

describe("rootSearchSchema", () => {
  it("parses empty object", () => {
    expect(rootSearchSchema.parse({})).toEqual({});
  });

  it("parses item param", () => {
    expect(rootSearchSchema.parse({ item: "abc-123" })).toEqual({
      item: "abc-123",
    });
  });

  it("strips unknown keys", () => {
    const result = rootSearchSchema.parse({ item: "x", unknown: "y" });
    expect(result).toEqual({ item: "x" });
  });
});

describe("listSearchSchema", () => {
  it("parses all filter params", () => {
    const input = {
      item: "id-1",
      tag: "work",
      sort: "modified",
      order: "desc",
      cat: "cat-1",
    };
    expect(listSearchSchema.parse(input)).toEqual(input);
  });

  it("rejects invalid sort value", () => {
    expect(() => listSearchSchema.parse({ sort: "invalid" })).toThrow();
  });

  it("rejects invalid order value", () => {
    expect(() => listSearchSchema.parse({ order: "random" })).toThrow();
  });

  it("allows all valid sort values", () => {
    for (const sort of ["created", "modified", "priority", "due"]) {
      expect(listSearchSchema.parse({ sort })).toEqual({ sort });
    }
  });
});
