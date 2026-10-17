// 학교 날짜 helper(`shared/lib/korea-date.ts`)와 같은 기준이다. 기기 시간대를 따르면 같은 대화의
// 날짜 구분선과 묶음 경계가 기기마다 달라진다.
const TIME_ZONE = "Asia/Seoul";

// 포매터 생성이 포매팅보다 훨씬 비싸서 메시지마다 만들지 않는다.
const timeFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
});
const dayFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 버블과 시간 카드에 쓰는 "오후 3:12". */
export function formatMessageTime(sentAt: string): string {
  return timeFormatter.format(new Date(sentAt));
}

/** 날짜 구분선의 "2026년 8월 28일 금요일". 한국 날짜로 오늘과 어제는 `오늘`, `어제`로 줄인다. */
export function formatMessageDay(sentAt: string, now = Date.now()): string {
  const day = dayKeyFormatter.format(new Date(sentAt));
  if (day === dayKeyFormatter.format(now)) return "오늘";
  if (day === dayKeyFormatter.format(now - DAY_MS)) return "어제";
  return dayFormatter.format(new Date(sentAt));
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

/** 이 메시지 위에 날짜 구분선을 그려야 하는지. */
export function startsMessageDay(
  previous: { sentAt: string } | undefined,
  message: { sentAt: string },
): boolean {
  return !previous || !isSameMessageDay(previous.sentAt, message.sentAt);
}
