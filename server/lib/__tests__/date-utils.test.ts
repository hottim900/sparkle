import { describe, it, expect } from "vitest";
import { validateDateParam } from "../date-utils.js";

describe("validateDateParam", () => {
  it("returns null for valid date", () => {
    expect(validateDateParam("2026-03-27")).toBeNull();
  });

  it("returns null for leap year date", () => {
    expect(validateDateParam("2024-02-29")).toBeNull();
  });

  it("returns null for end-of-month dates", () => {
    expect(validateDateParam("2026-01-31")).toBeNull();
    expect(validateDateParam("2026-04-30")).toBeNull();
  });

  it("rejects invalid format (single-digit month)", () => {
    const result = validateDateParam("2026-3-27");
    expect(result).toContain("Invalid date format");
  });

  it("rejects invalid format (no dashes)", () => {
    const result = validateDateParam("20260327");
    expect(result).toContain("Invalid date format");
  });

  it("rejects invalid format (extra characters)", () => {
    const result = validateDateParam("2026-03-27T00:00");
    expect(result).toContain("Invalid date format");
  });

  it("rejects month 00", () => {
    const result = validateDateParam("2026-00-15");
    expect(result).toContain("Invalid date");
  });

  it("rejects month 13", () => {
    const result = validateDateParam("2026-13-01");
    expect(result).toContain("Invalid date");
  });

  it("rejects month 99", () => {
    const result = validateDateParam("2026-99-01");
    expect(result).toContain("Invalid date");
  });

  it("rejects day 00", () => {
    const result = validateDateParam("2026-03-00");
    expect(result).toContain("Invalid date");
  });

  it("rejects day 32", () => {
    const result = validateDateParam("2026-03-32");
    expect(result).toContain("Invalid date");
  });

  it("rejects Feb 30", () => {
    const result = validateDateParam("2026-02-30");
    expect(result).toContain("Invalid date");
  });

  it("rejects Feb 29 on non-leap year", () => {
    const result = validateDateParam("2025-02-29");
    expect(result).toContain("Invalid date");
  });

  it("rejects Apr 31", () => {
    const result = validateDateParam("2026-04-31");
    expect(result).toContain("Invalid date");
  });
});
