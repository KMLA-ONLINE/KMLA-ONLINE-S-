// 계정이 바뀌면 버려야 하는 값이라 키 자체는 `user-scoped-storage`가 소유한다.
import { RECENT_SEARCH_STORAGE_KEY } from "~/shared/lib/user-scoped-storage";

const MAX_RECENT = 10;

/** 검색 결과 행과 같은 모양. `avatarPath`는 signed URL이 아니라 원본 Storage path다 —
 * DATA_CACHE_POLICY.md에 따라 signed URL은 localStorage에 두지 않고, 보여줄 때마다
 * `createProfileMediaUrls`/`createGroupMediaUrls`로 새로 구한다. */
export interface RecentSearchEntry {
  kind: "profile" | "group";
  id: string;
  name: string;
  avatarPath: string | null;
}

export function readRecentSearchEntries(): RecentSearchEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCH_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentSearchEntry);
  } catch {
    return [];
  }
}

export function addRecentSearchEntry(entry: RecentSearchEntry): void {
  if (typeof window === "undefined") return;
  const current = readRecentSearchEntries();
  const deduped = current.filter(
    (existing) => !(existing.kind === entry.kind && existing.id === entry.id),
  );
  const next = [entry, ...deduped].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(
      RECENT_SEARCH_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    // 용량 초과. 다음 클릭에서 다시 시도한다.
  }
}

function isRecentSearchEntry(value: unknown): value is RecentSearchEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "profile" || candidate.kind === "group") &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    (candidate.avatarPath === null || typeof candidate.avatarPath === "string")
  );
}
