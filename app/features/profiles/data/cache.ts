export const BIRTHDAY_STALE_TIME = 60 * 60 * 1000;
export const BIRTHDAY_GC_TIME = 60 * 60 * 1000;

export const birthdayKeys = {
  all: ["birthdays"] as const,
  today: (referenceDate: string) =>
    [...birthdayKeys.all, "today", referenceDate] as const,
  month: (referenceDate: string) =>
    [...birthdayKeys.all, "month", referenceDate] as const,
  year: (referenceDate: string) =>
    [...birthdayKeys.all, "year", referenceDate] as const,
};

/**
 * 이 탭에서 바꾼 공개 ID. 바꾸기 전 주소는 history에 남아 있어 뒤로가기가 그리로 간다. 그 주소에 프로필이 없을 때만
 * 새 주소로 바꿔 든다 — 그 사이 다른 사람이 옛 ID를 가져갔다면 그 사람 프로필이 맞다.
 */
const renamedPubIds = new Map<string, string>();

export function rememberRenamedPubId(from: string, to: string) {
  if (from === to) return;
  renamedPubIds.set(from, to);
  // 다시 바꾸면 더 옛 주소도 지금 주소로 간다.
  for (const [old, next] of renamedPubIds) {
    if (next === from) renamedPubIds.set(old, to);
  }
  renamedPubIds.delete(to);
}

export function renamedPubId(from: string): string | undefined {
  return renamedPubIds.get(from);
}
