const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Formats a stored instant as a Seoul `datetime-local` value. */
export function toSeoulInput(value: string): string {
  const time = new Date(value).getTime();

  if (!Number.isFinite(time)) return "";

  return new Date(time + SEOUL_OFFSET_MS).toISOString().slice(0, 16);
}

/**
 * Converts a Seoul `datetime-local` value to ISO. An input left at the stored
 * value returns the stored instant so editing other fields keeps its seconds.
 */
export function seoulInputToIso(value: string, stored?: string): string | null {
  if (!value) return null;

  if (stored !== undefined && value === toSeoulInput(stored)) {
    return new Date(stored).toISOString();
  }

  const date = new Date(`${value}:00+09:00`);

  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
