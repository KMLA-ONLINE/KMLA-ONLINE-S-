import type { Locale } from "~/shared/i18n/language";

// 학교 날짜 helper(`shared/lib/korea-date.ts`)와 같은 기준이다. 기기 시간대를 따르면 같은 대화의
// 대화 흐름 구분선과 묶음 경계가 기기마다 달라진다.
const TIME_ZONE = "Asia/Seoul";

// 포매터 생성이 포매팅보다 훨씬 비싸서 메시지마다 만들지 않고 언어별로 하나씩 둔다.
function makeFormatters(locale: Locale) {
  const tag = locale === "en" ? "en-US" : "ko-KR";
  return {
    time: new Intl.DateTimeFormat(tag, {
      timeZone: TIME_ZONE,
      hour: "numeric",
      minute: "2-digit",
    }),
    day: new Intl.DateTimeFormat(tag, {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    }),
  };
}
const formatters: Record<Locale, ReturnType<typeof makeFormatters>> = {
  ko: makeFormatters("ko"),
  en: makeFormatters("en"),
};
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 버블과 시간 카드에 쓰는 "오후 3:12". */
export function formatMessageTime(
  sentAt: string,
  locale: Locale = "ko",
): string {
  return formatters[locale].time.format(new Date(sentAt));
}

/** 날짜 표시 "2026년 8월 28일 금요일". 한국 날짜로 오늘과 어제는 `오늘`, `어제`로 줄인다. */
export function formatMessageDay(
  sentAt: string,
  now = Date.now(),
  locale: Locale = "ko",
): string {
  const day = dayKeyFormatter.format(new Date(sentAt));
  const en = locale === "en";
  if (day === dayKeyFormatter.format(now)) return en ? "Today" : "오늘";
  if (day === dayKeyFormatter.format(now - DAY_MS))
    return en ? "Yesterday" : "어제";
  return formatters[locale].day.format(new Date(sentAt));
}

/** 대화 흐름 구분선의 "오늘 오후 3:12". 날짜는 `formatMessageDay`와 같이 줄인다. */
export function formatMessageSessionStart(
  sentAt: string,
  now = Date.now(),
  locale: Locale = "ko",
): string {
  return `${formatMessageDay(sentAt, now, locale)} ${formatMessageTime(sentAt, locale)}`;
}

// 한국은 일광 절약 시간이 없어 하루가 늘 24시간이다.
const DAY_MS = 24 * 60 * 60_000;

/** 한국 날짜("2026-08-28"). 같은 날인지 비교하는 열쇠다. */
export function messageDayKey(sentAt: string): string {
  return dayKeyFormatter.format(new Date(sentAt));
}

export function isSameMessageDay(a: string, b: string): boolean {
  return messageDayKey(a) === messageDayKey(b);
}

/** 고정 메시지 목록에서 이 메시지 위에 날짜 구분선을 그려야 하는지. */
export function startsMessageDay(
  previous: { sentAt: string } | undefined,
  message: { sentAt: string },
): boolean {
  return !previous || !isSameMessageDay(previous.sentAt, message.sentAt);
}
