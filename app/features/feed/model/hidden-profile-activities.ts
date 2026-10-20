export interface HiddenProfileActivity {
  postId: string;
  hiddenUntil: number;
}

export const PROFILE_ACTIVITY_HIDE_MS = 24 * 60 * 60 * 1000;

/** Only IDs and expiration times are stored on the device; post content stays in memory. */
export function activeHiddenProfileActivities(
  entries: readonly HiddenProfileActivity[],
  now = Date.now(),
): HiddenProfileActivity[] {
  const seen = new Set<string>();
  return entries
    .filter(
      (entry) =>
        typeof entry?.postId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          entry.postId,
        ) &&
        Number.isFinite(entry.hiddenUntil) &&
        entry.hiddenUntil > now,
    )
    .sort((a, b) => b.hiddenUntil - a.hiddenUntil)
    .filter((entry) => {
      if (seen.has(entry.postId)) return false;
      seen.add(entry.postId);
      return true;
    });
}

export function parseHiddenProfileActivities(
  raw: string | null,
  now = Date.now(),
): HiddenProfileActivity[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? activeHiddenProfileActivities(value, now)
      : [];
  } catch {
    return [];
  }
}

export function hideProfileActivity(
  entries: readonly HiddenProfileActivity[],
  postId: string,
  now = Date.now(),
): HiddenProfileActivity[] {
  return activeHiddenProfileActivities(
    [
      { postId, hiddenUntil: now + PROFILE_ACTIVITY_HIDE_MS },
      ...entries.filter((entry) => entry.postId !== postId),
    ],
    now,
  );
}

export function unhideProfileActivity(
  entries: readonly HiddenProfileActivity[],
  postId: string,
): HiddenProfileActivity[] {
  return entries.filter((entry) => entry.postId !== postId);
}
