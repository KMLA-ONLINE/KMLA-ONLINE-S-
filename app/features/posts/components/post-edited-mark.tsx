import { formatAbsoluteTime } from "~/shared/lib/time";

/**
 * "· 수정됨". 앞의 가운뎃점까지 이 컴포넌트가 갖는다 — 호출부가 `edited_at` 조건을 구분자와
 * 라벨에 두 번 쓰게 되면 한쪽만 고치는 실수가 반드시 나온다.
 */
export function PostEditedMark({ at }: { at: string | null }) {
  if (!at) return null;
  const absolute = formatAbsoluteTime(at);

  return (
    <>
      <span aria-hidden="true">·</span>
      <span title={absolute ? `${absolute}에 수정됨` : undefined}>수정됨</span>
    </>
  );
}
