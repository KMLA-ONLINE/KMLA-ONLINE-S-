import type { Locale } from "~/shared/i18n/language";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// 포매터 생성은 실제 포매팅보다 훨씬 비싸다. 피드 한 화면에 타임스탬프가 수십 개이고 1분마다
// 다시 그리므로, 렌더마다 만들지 않고 언어별로 모듈에서 한 번만 만든다.
function absoluteFormat(locale: Locale): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
const ABSOLUTE_FORMAT: Record<Locale, Intl.DateTimeFormat> = {
  ko: absoluteFormat("ko"),
  en: absoluteFormat("en"),
};

/**
 * ISO 문자열을 ms로. 파싱할 수 없으면 `null`.
 *
 * 두 포매터가 공유하는 유일한 파싱 지점이다. `new Date("garbage")`는 던지지 않고 `NaN`을
 * 돌려주는데, 그게 그대로 흘러가면 `Intl`이 `RangeError`를 던져 **화면 전체가 죽는다**.
 * 피드 한 행의 잘못된 값이 페이지를 날리면 안 되므로 여기서 막는다.
 */
function parseTimestamp(value: string): number | null {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 피드와 채팅 목록이 원하는 거칠기의 "얼마나 지났는지". 값이 이상하면 `null`.
 *
 * `now`를 안에서 `Date.now()`로 읽지 않고 인자로 받는다. 한 화면에 타임스탬프가 수십 개일 때
 * 각자 시계를 읽으면 같은 순간을 미세하게 다른 기준으로 재고, 1분 경계에 걸친 것들이 제각각
 * 갱신된다. `useClientNow()`가 그 하나의 시계다.
 */
export function formatRelativeTime(
  value: string,
  now: number,
  locale: Locale = "ko",
): string | null {
  const ms = parseTimestamp(value);
  if (ms === null) return null;

  const elapsedMs = Math.max(0, now - ms);
  const en = locale === "en";

  if (elapsedMs < MINUTE_MS) return en ? "just now" : "방금";
  if (elapsedMs < HOUR_MS) {
    const minutes = Math.floor(elapsedMs / MINUTE_MS);
    return en ? `${minutes} min ago` : `${minutes}분전`;
  }
  if (elapsedMs < DAY_MS) {
    const hours = Math.floor(elapsedMs / HOUR_MS);
    return en ? `${hours} h ago` : `${hours}시간전`;
  }

  const days = Math.floor(elapsedMs / DAY_MS);
  return en ? `${days} d ago` : `${days}일전`;
}

/** 툴팁과 스크린 리더에 쓰는 전체 시각. 값이 이상하면 `null`. */
export function formatAbsoluteTime(
  value: string,
  locale: Locale = "ko",
): string | null {
  const ms = parseTimestamp(value);
  return ms === null ? null : ABSOLUTE_FORMAT[locale].format(ms);
}

const DATE_TIME_FORMAT: Record<Locale, Intl.DateTimeFormat> = {
  ko: new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }),
  en: new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }),
};

/** 만료·신청 시각처럼 화면에 한 번 적는 짧은 일시. 서버가 준 값이라 파싱 실패는 다루지 않는다. */
export function formatDateTime(value: string, locale: Locale = "ko"): string {
  return DATE_TIME_FORMAT[locale].format(new Date(value));
}
