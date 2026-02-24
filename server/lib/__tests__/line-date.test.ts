import { describe, it, expect } from "vitest";
import { parseDate } from "../line-date.js";

describe("parseDate", () => {
  const refDate = new Date(2026, 2, 1, 12); // 2026-03-01 12:00 (Sunday)

  // Clear keywords
  it("returns clear=true for '清除'", () => {
    const result = parseDate("清除", refDate);
    expect(result).toEqual({ success: true, date: null, clear: true });
  });

  it("returns clear=true for 'none'", () => {
    const result = parseDate("none", refDate);
    expect(result).toEqual({ success: true, date: null, clear: true });
  });

  it("returns clear=true for 'clear'", () => {
    const result = parseDate("clear", refDate);
    expect(result).toEqual({ success: true, date: null, clear: true });
  });

  // Taiwan casual dates
  it("parses '今天' to today's date", () => {
    const result = parseDate("今天", refDate);
    expect(result.success).toBe(true);
    expect(result.date).toBe("2026-03-01");
  });

  it("parses '明天' to tomorrow's date", () => {
    const result = parseDate("明天", refDate);
    expect(result.success).toBe(true);
    expect(result.date).toBe("2026-03-02");
  });

  it("parses '後天' to day after tomorrow", () => {
    const result = parseDate("後天", refDate);
    expect(result.success).toBe(true);
    expect(result.date).toBe("2026-03-03");
  });

  it("parses '大後天' to 3 days from now", () => {
    const result = parseDate("大後天", refDate);
    expect(result.success).toBe(true);
    expect(result.date).toBe("2026-03-04");
  });

  // Deadline format
  it("parses '3天後' to 3 days from now", () => {
    const result = parseDate("3天後", refDate);
    expect(result.success).toBe(true);
    expect(result.date).toBe("2026-03-04");
  });

  // Standard formats
  it("parses '2026-03-15' directly", () => {
    const result = parseDate("2026-03-15", refDate);
    expect(result.success).toBe(true);
    expect(result.date).toBe("2026-03-15");
  });

  it("parses '3/15' to March 15 of current year", () => {
    const result = parseDate("3/15", refDate);
    expect(result.success).toBe(true);
    expect(result.date).toBe("2026-03-15");
  });

  // Failure
  it("returns success=false for unparseable string", () => {
    const result = parseDate("不知道什麼", refDate);
    expect(result.success).toBe(false);
    expect(result.date).toBeNull();
  });

  it("returns success=false for empty string", () => {
    const result = parseDate("", refDate);
    expect(result.success).toBe(false);
    expect(result.date).toBeNull();
  });
});
