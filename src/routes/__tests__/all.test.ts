import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedRedirects: Record<string, unknown>[] = [];

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  redirect: (opts: Record<string, unknown>) => {
    capturedRedirects.push(opts);
    const r = new Response(null, { status: 307 });
    (r as Record<string, unknown>).options = opts;
    throw r;
  },
}));

vi.mock("@/lib/search-params", () => ({
  rootSearchSchema: {
    parse: (v: unknown) => v,
  },
}));

const { Route } = await import("@/routes/all");
const beforeLoad = (Route as Record<string, unknown>).beforeLoad as (ctx: {
  search: { item?: string };
}) => void;

describe("all.tsx backward compat route", () => {
  beforeEach(() => {
    capturedRedirects = [];
  });

  it("redirects ?item=X to /item/$id with replace: true", () => {
    expect(() => beforeLoad({ search: { item: "abc123" } })).toThrow();
    expect(capturedRedirects[0]).toEqual({
      to: "/item/$id",
      params: { id: "abc123" },
      replace: true,
    });
  });

  it("redirects to /dashboard when no ?item= param", () => {
    expect(() => beforeLoad({ search: {} })).toThrow();
    expect(capturedRedirects[0]).toEqual({
      to: "/dashboard",
      replace: true,
    });
  });

  it("redirects to /dashboard when item is undefined", () => {
    expect(() => beforeLoad({ search: { item: undefined } })).toThrow();
    expect(capturedRedirects[0]).toEqual({
      to: "/dashboard",
      replace: true,
    });
  });
});
