/**
 * Shared date validation utilities for route handlers.
 */

/**
 * Validate a YYYY-MM-DD date string for both format and semantic correctness.
 * Returns null if valid, or an error message string if invalid.
 */
export function validateDateParam(dateParam: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return "Invalid date format. Expected YYYY-MM-DD.";
  }
  const [y, m, d] = dateParam.split("-").map(Number);
  const parsed = new Date(y!, m! - 1, d!);
  if (isNaN(parsed.getTime()) || parsed.getMonth() !== m! - 1 || parsed.getDate() !== d!) {
    return "Invalid date. Month must be 1-12, day must be valid.";
  }
  return null;
}
