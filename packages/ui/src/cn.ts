/**
 * Join class names, skipping falsy values.
 * Kept dependency-free; swapped for tailwind-merge when Tailwind lands (Phase 3).
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
