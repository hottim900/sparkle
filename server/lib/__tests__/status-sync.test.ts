import { NOTE_STATUSES, TODO_STATUSES, SCRATCH_STATUSES } from "../item-type-system.js";
import { statusEnum } from "../../schemas/items.js";

describe("status constants sync", () => {
  it("type-specific status arrays cover all statuses in Zod schema", () => {
    const fromArrays = new Set([...NOTE_STATUSES, ...TODO_STATUSES, ...SCRATCH_STATUSES]);
    const fromSchema = new Set(statusEnum.options);

    expect(fromArrays).toEqual(fromSchema);
  });

  it("no unexpected statuses in type arrays that are missing from schema", () => {
    const schemaStatuses = new Set(statusEnum.options);
    for (const s of NOTE_STATUSES) expect(schemaStatuses.has(s)).toBe(true);
    for (const s of TODO_STATUSES) expect(schemaStatuses.has(s)).toBe(true);
    for (const s of SCRATCH_STATUSES) expect(schemaStatuses.has(s)).toBe(true);
  });
});
