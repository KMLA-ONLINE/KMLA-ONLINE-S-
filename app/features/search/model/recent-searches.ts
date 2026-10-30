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
  const deduped = readRecentSearchEntries().filter(
    (existing) => !isSameRecentSearchEntry(existing, entry.kind, entry.id),
  );
  writeRecentSearchEntries([entry, ...deduped].slice(0, MAX_RECENT));
}

/** 사용자가 지운 항목은 다시 눌러 들어가기 전까지 돌아오지 않는다(기능 명세 §3.6). */
export function removeRecentSearchEntry(
  kind: RecentSearchEntry["kind"],
  id: string,
): void {
  if (typeof window === "undefined") return;
  writeRecentSearchEntries(
    readRecentSearchEntries().filter(
      (existing) => !isSameRecentSearchEntry(existing, kind, id),
    ),
  );
}

export function isSameRecentSearchEntry(
  entry: Pick<RecentSearchEntry, "kind" | "id">,
  kind: RecentSearchEntry["kind"],
  id: string,
): boolean {
  return entry.kind === kind && entry.id === id;
}

function writeRecentSearchEntries(entries: RecentSearchEntry[]): void {
  try {
    window.localStorage.setItem(
      RECENT_SEARCH_STORAGE_KEY,
      JSON.stringify(entries),
    );
  } catch {
    // 용량 초과 등으로 쓰지 못하면 이전 목록이 남고, 다음 추가·삭제에서 다시 쓴다.
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
