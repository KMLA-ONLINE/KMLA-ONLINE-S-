const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// 포매터 생성은 실제 포매팅보다 훨씬 비싸다. 피드 한 화면에 타임스탬프가 수십 개이고 1분마다
// 다시 그리므로, 렌더마다 만들지 않고 모듈에서 한 번만 만든다.
const ABSOLUTE_FORMAT = new Intl.DateTimeFormat("ko", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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
export function formatRelativeTime(value: string, now: number): string | null {
  const ms = parseTimestamp(value);
  if (ms === null) return null;

  const elapsedMs = Math.max(0, now - ms);

  if (elapsedMs < MINUTE_MS) return "방금";
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)}분전`;
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)}시간전`;

  return `${Math.floor(elapsedMs / DAY_MS)}일전`;
}

/** 툴팁과 스크린 리더에 쓰는 전체 시각. 값이 이상하면 `null`. */
export function formatAbsoluteTime(value: string): string | null {
  const ms = parseTimestamp(value);
  return ms === null ? null : ABSOLUTE_FORMAT.format(ms);
}
