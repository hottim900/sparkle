import { describe, it, expect } from "vitest";
import { getTargetPath } from "@/routes/item.$id";
import type { Item } from "@/lib/types";

function makeItem(type: Item["type"], status: Item["status"]): Item {
  return {
    id: "test-id",
    type,
    status,
    title: "test",
    content: "",
    priority: null,
    due: null,
    tags: "[]",
    source: null,
    origin: "web",
    aliases: "[]",
    linked_note_id: null,
    linked_note_title: null,
    linked_todo_count: 0,
    share_visibility: null,
    category_id: null,
    category_name: null,
    viewed_at: null,
    is_private: false,
    export_path: null,
    paused: 0,
    paused_at: null,
    paused_context: null,
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
  };
}

describe("getTargetPath", () => {
  it("maps note+fleeting to /notes/fleeting", () => {
    expect(getTargetPath(makeItem("note", "fleeting"))).toBe("/notes/fleeting");
  });

  it("maps note+developing to /notes/developing", () => {
    expect(getTargetPath(makeItem("note", "developing"))).toBe("/notes/developing");
  });

  it("maps note+permanent to /notes/permanent", () => {
    expect(getTargetPath(makeItem("note", "permanent"))).toBe("/notes/permanent");
  });

  it("maps note+exported to null (standalone view)", () => {
    expect(getTargetPath(makeItem("note", "exported"))).toBeNull();
  });

  it("maps note+archived to /archived", () => {
    expect(getTargetPath(makeItem("note", "archived"))).toBe("/archived");
  });

  it("maps todo+active to /todos", () => {
    expect(getTargetPath(makeItem("todo", "active"))).toBe("/todos");
  });

  it("maps todo+done to /todos/done", () => {
    expect(getTargetPath(makeItem("todo", "done"))).toBe("/todos/done");
  });

  it("maps todo+archived to /archived", () => {
    expect(getTargetPath(makeItem("todo", "archived"))).toBe("/archived");
  });

  it("maps scratch+draft to /scratch", () => {
    expect(getTargetPath(makeItem("scratch", "draft"))).toBe("/scratch");
  });

  it("maps scratch+archived to /archived", () => {
    expect(getTargetPath(makeItem("scratch", "archived"))).toBe("/archived");
  });

  it("falls back to /dashboard for unknown type", () => {
    const item = makeItem("note", "fleeting");
    (item as unknown as { type: string }).type = "unknown";
    expect(getTargetPath(item as Item)).toBe("/dashboard");
  });
});
