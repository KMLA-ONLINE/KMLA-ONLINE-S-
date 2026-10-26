import type { AnonymousActivityRestriction } from "~/features/posts/model/types";
import { useLocale, useT } from "~/shared/i18n";
import { formatDateTime } from "~/shared/lib/time";

/** 익명 활동 제한 안내 한 줄. 놓이는 자리마다 여백과 글자 크기가 달라 `className`으로 받는다. */
export function AnonymousActivityRestrictionNotice({
  restriction,
  className,
}: {
  restriction: AnonymousActivityRestriction;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <p className={className}>
      {t("익명 활동이 제한되어 있습니다. 사유: {reason} · 만료: {expires}", {
        reason: restriction.reason,
        expires: formatDateTime(restriction.expires_at, locale),
      })}
    </p>
  );
}
