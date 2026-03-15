import { describe, it, expect } from "vitest";
import {
  TYPE_STATUS_MAP,
  NOTE_STATUSES,
  TODO_STATUSES,
  SCRATCH_STATUSES,
  isValidTypeStatus,
  getAutoMappedStatus,
  defaultStatusForType,
} from "../item-type-system.js";
import { statusEnum, createItemSchema } from "../../schemas/items.js";

describe("item-type-system", () => {
  describe("TYPE_STATUS_MAP is single source of truth", () => {
    it("derived constants match TYPE_STATUS_MAP", () => {
      expect(NOTE_STATUSES).toBe(TYPE_STATUS_MAP.note);
      expect(TODO_STATUSES).toBe(TYPE_STATUS_MAP.todo);
      expect(SCRATCH_STATUSES).toBe(TYPE_STATUS_MAP.scratch);
    });

    it("all statuses in map are covered by Zod statusEnum", () => {
      const fromMap = new Set([
        ...TYPE_STATUS_MAP.note,
        ...TYPE_STATUS_MAP.todo,
        ...TYPE_STATUS_MAP.scratch,
      ]);
      const fromSchema = new Set(statusEnum.options);
      expect(fromMap).toEqual(fromSchema);
    });
  });

  describe("isValidTypeStatus", () => {
    it("accepts valid note statuses", () => {
      for (const s of TYPE_STATUS_MAP.note) {
        expect(isValidTypeStatus("note", s)).toBe(true);
      }
    });

    it("rejects invalid note statuses", () => {
      expect(isValidTypeStatus("note", "active")).toBe(false);
      expect(isValidTypeStatus("note", "done")).toBe(false);
    });

    it("accepts valid todo statuses", () => {
      for (const s of TYPE_STATUS_MAP.todo) {
        expect(isValidTypeStatus("todo", s)).toBe(true);
      }
    });

    it("rejects invalid todo statuses", () => {
      expect(isValidTypeStatus("todo", "fleeting")).toBe(false);
    });

    it("accepts valid scratch statuses", () => {
      for (const s of TYPE_STATUS_MAP.scratch) {
        expect(isValidTypeStatus("scratch", s)).toBe(true);
      }
    });

    it("rejects unknown type", () => {
      expect(isValidTypeStatus("unknown", "fleeting")).toBe(false);
    });
  });

  describe("getAutoMappedStatus", () => {
    it("returns null for same type", () => {
      expect(getAutoMappedStatus("note", "note", "fleeting")).toBeNull();
    });

    it("maps todo→note", () => {
      expect(getAutoMappedStatus("todo", "note", "done")).toBe("permanent");
      expect(getAutoMappedStatus("todo", "note", "active")).toBe("fleeting");
    });

    it("maps note→todo", () => {
      expect(getAutoMappedStatus("note", "todo", "developing")).toBe("active");
      expect(getAutoMappedStatus("note", "todo", "permanent")).toBe("done");
    });

    it("maps scratch↔note", () => {
      expect(getAutoMappedStatus("scratch", "note", "draft")).toBe("fleeting");
      expect(getAutoMappedStatus("note", "scratch", "fleeting")).toBe("draft");
    });

    it("maps scratch↔todo", () => {
      expect(getAutoMappedStatus("scratch", "todo", "draft")).toBe("active");
      expect(getAutoMappedStatus("todo", "scratch", "active")).toBe("draft");
    });
  });

  describe("createItemSchema type-status refine", () => {
    it("rejects invalid status for note type", () => {
      expect(() =>
        createItemSchema.parse({ title: "x", type: "note", status: "active" }),
      ).toThrow();
    });

    it("accepts valid status for todo type", () => {
      const result = createItemSchema.parse({ title: "x", type: "todo", status: "active" });
      expect(result.status).toBe("active");
    });

    it("accepts missing status (uses default)", () => {
      const result = createItemSchema.parse({ title: "x" });
      expect(result.status).toBeUndefined();
    });

    it("rejects todo status for scratch type", () => {
      expect(() =>
        createItemSchema.parse({ title: "x", type: "scratch", status: "active" }),
      ).toThrow();
    });
  });

  describe("defaultStatusForType", () => {
    it("returns fleeting for note", () => {
      expect(defaultStatusForType("note")).toBe("fleeting");
    });
    it("returns active for todo", () => {
      expect(defaultStatusForType("todo")).toBe("active");
    });
    it("returns draft for scratch", () => {
      expect(defaultStatusForType("scratch")).toBe("draft");
    });
  });
});
