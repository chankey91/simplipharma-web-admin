/** Normalize category strings for comparison (trim, collapse spaces, case-insensitive). */
export function normalizeCategoryKey(s: string | undefined | null): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** True when two category labels refer to the same category despite casing/spacing differences. */
export function categoriesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  return normalizeCategoryKey(a) === normalizeCategoryKey(b);
}
