import { EyeOffIcon, FlagIcon, Trash2Icon } from "lucide-react";
import { Link } from "react-router";

import { GroupPostReportDescriptions } from "~/features/posts/components/group-post-report-descriptions";
import type { GroupPostReportSummary } from "~/features/posts/data/group-reports";
import {
  GROUP_POST_REPORT_REASON_OPTIONS,
  type GroupPostReportReason,
} from "~/features/posts/model/group-report";
import { RelativeTime } from "~/shared/components/relative-time";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";

/**
 * 신고 탭 카드.
 *
 * 헤더에는 판단 근거(총 신고 수, 사유별 집계, 최근 신고 시각)를, 그 아래 인용 블록에는
 * 판단 대상인 게시물을 둔다. 두 층을 시각적으로 분리해야 운영진이 "왜 올라왔는지"와
 * "무엇을 지우는지"를 헷갈리지 않는다.
 *
 * `report_count`는 마지막 무시 이후에 들어온 신고만 센다. 그 전에 무시한 신고가 있으면
 * `dismissed_count`로 함께 표시해 이미 한 번 판단한 게시물이라는 사실을 남긴다.
 */
export function GroupPostReportCard({
  report,
  groupId,
  slug,
  canModerate,
  onDismiss,
  onDelete,
}: {
  report: GroupPostReportSummary;
  groupId: string;
  slug: string;
  canModerate: boolean;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const authorName = report.author_name ?? report.author_label;
  const postTo = `/groups/${slug}/posts/${report.post_id}`;

  return (
    <article className="bg-card md:rounded-md">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/60 px-3 py-2 md:px-4">
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive tabular-nums">
          <FlagIcon className="size-3" aria-hidden="true" />
          신고 {report.report_count}
        </span>

        <ReasonCounts report={report} />

        <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          {report.dismissed_count > 0 ? (
            <span className="tabular-nums">
              이전 {report.dismissed_count}건 무시됨
            </span>
          ) : null}

          <RelativeTime value={report.latest_at} />
        </div>
      </header>

      <div className="px-3 py-2.5 md:px-4">
        <div className="border-l-2 border-border pl-3">
          <Link
            to={postTo}
            className="line-clamp-2 text-sm leading-5 font-semibold hover:underline md:text-base md:leading-6"
          >
            {report.title}
          </Link>

          {report.body_preview ? (
            <p className="mt-1 line-clamp-3 text-sm leading-5 whitespace-pre-wrap text-muted-foreground">
              {report.body_preview}
            </p>
          ) : null}

          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            {report.author_pub_id && report.author_name ? (
              <Link
                to={`/profile/${report.author_pub_id}`}
                className="flex min-w-0 items-center gap-1.5 hover:text-foreground"
              >
                <UserAvatar
                  src={report.author_avatar_path}
                  name={report.author_name}
                  className="size-5"
                />

                <span className="truncate">{authorName}</span>
              </Link>
            ) : (
              <span className="truncate">{report.author_label}</span>
            )}

            {report.author_identity === "staff" ? (
              <Badge
                variant="outline"
                className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground"
              >
                운영진
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="flex flex-wrap items-center gap-1 px-3 pb-2.5 md:px-4">
        {report.description_count > 0 ? (
          <GroupPostReportDescriptions
            groupId={groupId}
            postId={report.post_id}
            count={report.description_count}
          />
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            render={<Link to={postTo} />}
          >
            게시물 보기
          </Button>

          {canModerate ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={onDismiss}
              >
                <EyeOffIcon data-icon="inline-start" />
                무시
              </Button>

              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2Icon data-icon="inline-start" />
                삭제
              </Button>
            </>
          ) : null}
        </div>
      </footer>
    </article>
  );
}

function ReasonCounts({ report }: { report: GroupPostReportSummary }) {
  const counts: Record<GroupPostReportReason, number> = {
    abuse: report.abuse_count,
    sexual: report.sexual_count,
    privacy: report.privacy_count,
    impersonation: report.impersonation_count,
    spam: report.spam_count,
    other: report.other_count,
  };

  return (
    <>
      {GROUP_POST_REPORT_REASON_OPTIONS.map((option) => {
        const count = counts[option.value];

        if (count <= 0) return null;

        return (
          <Badge
            key={option.value}
            variant="outline"
            className="h-5 px-1.5 text-[11px] font-normal text-muted-foreground tabular-nums"
          >
            {option.label} {count}
          </Badge>
        );
      })}
    </>
  );
}
