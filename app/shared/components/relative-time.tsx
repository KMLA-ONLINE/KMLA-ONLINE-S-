import { useClientNow } from "~/shared/hooks/use-client-now";
import { formatAbsoluteTime, formatRelativeTime } from "~/shared/lib/time";

/**
 * ISO 타임스탬프를 "3분전"으로 그리고, 분이 넘어가면 스스로 고쳐 쓴다.
 *
 * 눈으로 읽는 사람과 스크린 리더가 서로 다른 문자열을 받는다. "3분전"은 목록을 훑을 때 빠르지만
 * 소리로 들으면 기준이 모호하고, 무엇보다 1분마다 값이 바뀌어 낭독 중에 갱신될 수 있다.
 *
 * 그 전달을 `title`이나 `dateTime`에 맡기지 않는다 — `title`은 스크린 리더마다 읽는 규칙이 다르고
 * `dateTime`은 대부분 아예 낭독되지 않는다. 확실히 동작하는 방법은 보이는 쪽을 `aria-hidden`으로
 * 감추고 읽히는 쪽을 `sr-only`로 따로 두는 것뿐이다. `title`은 마우스 툴팁 용도로만 남는다.
 *
 * 값이 파싱되지 않으면 아무것도 그리지 않는다. 피드 한 행의 잘못된 타임스탬프가 "NaN일전"으로
 * 보이거나 `Intl`의 `RangeError`로 화면 전체를 죽이는 것보다 낫다.
 */
export function RelativeTime({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const now = useClientNow();

  const relative = formatRelativeTime(value, now);
  const absolute = formatAbsoluteTime(value);
  if (relative === null || absolute === null) return null;

  return (
    <time dateTime={value} title={absolute} className={className}>
      <span aria-hidden="true">{relative}</span>
      <span className="sr-only">{absolute}</span>
    </time>
  );
}
