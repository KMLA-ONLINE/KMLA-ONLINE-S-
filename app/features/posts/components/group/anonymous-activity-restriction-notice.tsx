import { formatPostDate } from "~/features/posts/model/format";
import type { AnonymousActivityRestriction } from "~/features/posts/model/types";

/** 익명 활동 제한 안내 한 줄. 놓이는 자리마다 여백과 글자 크기가 달라 `className`으로 받는다. */
export function AnonymousActivityRestrictionNotice({
  restriction,
  className,
}: {
  restriction: AnonymousActivityRestriction;
  className?: string;
}) {
  return (
    <p className={className}>
      익명 활동이 제한되어 있습니다. 사유: {restriction.reason}
      {" · "}만료: {formatPostDate(restriction.expires_at)}
    </p>
  );
}
