// server/lib/item-type-system.ts
// Single source of truth for type<->status rules (TD-013)

export const TYPE_STATUS_MAP = {
  note: ["fleeting", "developing", "permanent", "exported", "archived"],
  todo: ["active", "done", "archived"],
  scratch: ["draft", "archived"],
} as const;

export type ItemType = keyof typeof TYPE_STATUS_MAP;
export type NoteStatus = (typeof TYPE_STATUS_MAP.note)[number];
export type TodoStatus = (typeof TYPE_STATUS_MAP.todo)[number];
export type ScratchStatus = (typeof TYPE_STATUS_MAP.scratch)[number];
export type ItemStatus = NoteStatus | TodoStatus | ScratchStatus;

// Derived constants (backwards compat re-exports)
export const NOTE_STATUSES = TYPE_STATUS_MAP.note;
export const TODO_STATUSES = TYPE_STATUS_MAP.todo;
export const SCRATCH_STATUSES = TYPE_STATUS_MAP.scratch;

export function isValidTypeStatus(type: string, status: string): boolean {
  const allowed = TYPE_STATUS_MAP[type as ItemType];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(status);
}

const TYPE_CONVERSION_MAP: Record<string, Record<string, string>> = {
  "todo\u2192note": {
    active: "fleeting",
    done: "permanent",
    archived: "archived",
  },
  "note\u2192todo": {
    fleeting: "active",
    developing: "active",
    permanent: "done",
    exported: "done",
    archived: "archived",
  },
  "scratch\u2192note": {
    draft: "fleeting",
    archived: "archived",
  },
  "scratch\u2192todo": {
    draft: "active",
    archived: "archived",
  },
  "note\u2192scratch": {
    fleeting: "draft",
    developing: "draft",
    permanent: "archived",
    exported: "archived",
    archived: "archived",
  },
  "todo\u2192scratch": {
    active: "draft",
    done: "archived",
    archived: "archived",
  },
};

export function getAutoMappedStatus(
  fromType: string,
  toType: string,
  currentStatus: string,
): string | null {
  if (fromType === toType) return null;
  const key = `${fromType}\u2192${toType}`;
  return TYPE_CONVERSION_MAP[key]?.[currentStatus] ?? null;
}

export function defaultStatusForType(type: string): string {
  if (type === "todo") return "active";
  if (type === "scratch") return "draft";
  return "fleeting";
}
