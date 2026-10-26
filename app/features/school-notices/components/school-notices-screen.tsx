import { ChevronRightIcon, MegaphoneIcon, PaperclipIcon } from "lucide-react";
import { Link } from "react-router";

import type { SchoolNotice } from "~/features/school-notices/data/school-notices";
import { RelativeTime } from "~/shared/components/relative-time";
import { useLocale, useT } from "~/shared/i18n";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/shared/ui/empty";

/**
 * 학교 인트라넷 공지의 최신 목록. 누르면 앱 안에서 본문을 연다. 첨부만 학교 사이트 로그인이
 * 필요하다.
 */
export function SchoolNoticesScreen({
  notices,
}: {
  notices: SchoolNotice[] | null;
}) {
  const t = useT();
  const locale = useLocale();
  if (notices === null) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        {t("학교 공지를 불러오지 못했습니다.")}
      </p>
    );
  }

  if (notices.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MegaphoneIcon />
          </EmptyMedia>
          <EmptyTitle>{t("아직 가져온 공지가 없습니다")}</EmptyTitle>
          <EmptyDescription>
            {t("학교 공지는 30분마다 새로 가져옵니다.")}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const syncedAt = notices[0].synced_at;

  return (
    <div className="py-4">
      <div className="space-y-1 px-4 pb-3 text-sm text-muted-foreground">
        {syncedAt ? (
          // 상대 시간이 요소라 한 문장으로 못 묶는다. 한국어는 시간이 앞, 영어는 뒤에 온다.
          locale === "en" ? (
            <p>
              Updated <RelativeTime value={syncedAt} />
            </p>
          ) : (
            <p>
              <RelativeTime value={syncedAt} /> 업데이트
            </p>
          )
        ) : null}
      </div>
      <ul className="divide-y border-y md:rounded-xl md:border-x">
        {notices.map((notice) => (
          <li key={notice.post_id}>
            <Link
              to={`/menu/notices/${notice.post_id}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {notice.posted_on.replaceAll("-", "/")}
                  </span>
                  <span aria-hidden>|</span>
                  <span>{notice.category}</span>
                  {notice.has_attachment ? (
                    <PaperclipIcon
                      className="size-3.5"
                      aria-label={t("첨부 있음")}
                    />
                  ) : null}
                </span>
                <span className="mt-0.5 block text-sm font-medium break-keep">
                  {notice.title}
                </span>
              </span>
              <ChevronRightIcon
                className="mt-1 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
