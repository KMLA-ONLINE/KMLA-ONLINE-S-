export function normalizeSearchInput(value: string): string {
  return value.normalize("NFC").trim();
}

export function hasMinimumSearchLength(value: string): boolean {
  return Array.from(normalizeSearchInput(value)).length >= 2;
}
