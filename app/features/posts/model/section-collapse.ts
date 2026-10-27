/**
 * 그룹 게시물 탭의 대표·고정 섹션 접힘 상태(기능 명세 §8.18). 카드·목록 보기처럼 현재 기기에만 두고
 * 서버와 동기화하지 않는다. 그룹별로 기억하며 기본은 펼침이다.
 */
const STORAGE_KEY = "kmla-online:group-sections:v1";

export type GroupPostSection = "featured" | "pinned";

type Stored = Record<string, Partial<Record<GroupPostSection, boolean>>>;

function readAll(): Stored {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Stored)
      : {};
  } catch {
    return {};
  }
}

export function readGroupSectionCollapsed(
  groupId: string,
  section: GroupPostSection,
): boolean {
  const entry = readAll()[groupId];
  return entry !== null && typeof entry === "object" && entry[section] === true;
}

export function writeGroupSectionCollapsed(
  groupId: string,
  section: GroupPostSection,
  collapsed: boolean,
): void {
  if (typeof window === "undefined") return;
  const all = readAll();
  const stored = all[groupId];
  const entry =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...stored }
      : {};
  if (collapsed) entry[section] = true;
  else delete entry[section];
  if (Object.keys(entry).length > 0) all[groupId] = entry;
  else delete all[groupId];
  if (Object.keys(all).length > 0)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  else window.localStorage.removeItem(STORAGE_KEY);
}
