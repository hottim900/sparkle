/**
 * Fields blocked from modification on exported items.
 * Shared across route handlers (primary guard) and updateItem (defensive guard).
 */
export const EXPORTED_BLOCKED_FIELDS = [
  "title",
  "content",
  "type",
  "priority",
  "due",
  "tags",
  "source",
  "origin",
  "aliases",
  "linked_note_id",
  "category_id",
  "paused",
  "paused_context",
] as const;
