const DAY_MS = 24 * 60 * 60 * 1000;

const KOREA_PARTS_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface SuspensionEnd {
  /** 한국 시간 해제 예정 시각. 예: `2026년 10월 23일 21:05` */
  label: string;
  /** 남은 일수. 하루가 안 남아도 1이다. */
  remainingDays: number;
}

/** 이용 정지 안내(§5.8)의 해제 예정 시각. 무기한이면 `null`. */
export function describeSuspensionEnd(
  expiresAt: string | null,
  now: number,
): SuspensionEnd | null {
  if (expiresAt === null) return null;

  const ms = Date.parse(expiresAt);
  const parts = KOREA_PARTS_FORMAT.formatToParts(ms);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    label: `${read("year")}년 ${read("month")}월 ${read("day")}일 ${read("hour")}:${read("minute")}`,
    remainingDays: Math.max(1, Math.ceil((ms - now) / DAY_MS)),
  };
}
