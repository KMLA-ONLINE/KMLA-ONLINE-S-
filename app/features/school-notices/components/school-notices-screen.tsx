import { ExternalLinkIcon, MegaphoneIcon, PaperclipIcon } from "lucide-react";

import type { SchoolNotice } from "~/features/school-notices/data/school-notices";
import { schoolNoticeUrl } from "~/features/school-notices/model/school-notice-link";
import { RelativeTime } from "~/shared/components/relative-time";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/shared/ui/empty";

/**
 * 학교 인트라넷 공지의 최신 목록. 본문은 가져오지 않고, 누르면 학교 사이트의 해당 공지를 새 탭으로
 * 연다. 학교 사이트는 로그인이 필요해 그 사실을 목록 위에 먼저 알린다.
 */
export function SchoolNoticesScreen({
  notices,
}: {
  notices: SchoolNotice[] | null;
}) {
  if (notices === null) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        학교 공지를 불러오지 못했습니다.
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
          <EmptyTitle>아직 가져온 공지가 없습니다</EmptyTitle>
          <EmptyDescription>
            학교 공지는 30분마다 새로 가져옵니다.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const syncedAt = notices[0].synced_at;

  return (
    <div className="py-4">
      <div className="space-y-1 px-4 pb-3 text-sm text-muted-foreground">
        <p>학교 사이트에 로그인되어 있어야 공지가 열려요.</p>
        {syncedAt ? (
          <p>
            <RelativeTime value={syncedAt} /> 업데이트
          </p>
        ) : null}
      </div>
      <ul className="divide-y border-y md:rounded-xl md:border-x">
        {notices.map((notice) => (
          <li key={notice.post_id}>
            <a
              href={schoolNoticeUrl(notice.post_id)}
              target="_blank"
              rel="noreferrer"
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
                      aria-label="첨부 있음"
                    />
                  ) : null}
                </span>
                <span className="mt-0.5 block text-sm font-medium break-keep">
                  {notice.title}
                </span>
              </span>
              <ExternalLinkIcon
                className="mt-1 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="sr-only">(새 탭)</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
