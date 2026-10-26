import { getCurrentLocale, type Locale } from "~/shared/i18n";

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

/** 영어 화면도 한국 시간으로 보여 주되, 읽는 사람이 한국에 없을 수 있어 시간대를 붙인다. */
const ENGLISH_LABEL_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface SuspensionEnd {
  /** 한국 시간 해제 예정 시각. 예: `2026년 10월 23일 21:05` */
  label: string;
  /** 남은 일수. 하루가 안 남아도 1이고, 해제 시각이 지났으면 0이다. */
  remainingDays: number;
}

/**
 * 이용 정지 안내(§5.8)의 해제 예정 시각. 무기한이면 `null`.
 * 관리자 명단처럼 `useLocale()`을 넘기지 않는 호출자를 위해 현재 화면 언어가 기본값이다.
 */
export function describeSuspensionEnd(
  expiresAt: string | null,
  now: number,
  locale: Locale = getCurrentLocale(),
): SuspensionEnd | null {
  if (expiresAt === null) return null;

  const ms = Date.parse(expiresAt);
  const remainingDays = ms <= now ? 0 : Math.ceil((ms - now) / DAY_MS);
  if (locale === "en") {
    return { label: `${ENGLISH_LABEL_FORMAT.format(ms)} KST`, remainingDays };
  }

  const parts = KOREA_PARTS_FORMAT.formatToParts(ms);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    label: `${read("year")}년 ${read("month")}월 ${read("day")}일 ${read("hour")}:${read("minute")}`,
    remainingDays,
  };
}
