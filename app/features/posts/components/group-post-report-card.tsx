import { Trash2Icon } from "lucide-react";
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

export function GroupPostReportCard({
  report,
  groupId,
  slug,
  canDelete,
  onDelete,
}: {
  report: GroupPostReportSummary;
  groupId: string;
  slug: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const authorName = report.author_name ?? report.author_label;

  return (
    <article className="bg-card px-3 py-2.5 md:rounded-md md:px-4 md:py-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            to={`/groups/${slug}/posts/${report.post_id}`}
            className="line-clamp-2 text-sm leading-5 font-semibold hover:underline md:text-base md:leading-6"
          >
            {report.title}
          </Link>

          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
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

            <span aria-hidden="true">·</span>

            <RelativeTime value={report.latest_at} />
          </div>
        </div>

        <Badge variant="secondary" className="shrink-0">
          {report.report_count}
        </Badge>
      </div>

      {report.body_preview ? (
        <p className="mt-1.5 line-clamp-2 text-sm leading-5 whitespace-pre-wrap text-muted-foreground">
          {report.body_preview}
        </p>
      ) : null}

      <ReasonCounts report={report} />

      <div className="mt-1.5 flex items-center gap-1 pt-0.5">
        {report.description_count > 0 ? (
          <GroupPostReportDescriptions
            groupId={groupId}
            postId={report.post_id}
            count={report.description_count}
          />
        ) : null}

        <Link
          to={`/groups/${slug}/posts/${report.post_id}`}
          className="ml-auto rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          게시물 보기
        </Link>

        {canDelete ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="게시물 삭제"
            className="text-destructive"
            onClick={onDelete}
          >
            <Trash2Icon />
          </Button>
        ) : null}
      </div>
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
    <div className="mt-1.5 flex flex-wrap gap-1">
      {GROUP_POST_REPORT_REASON_OPTIONS.map((option) => {
        const count = counts[option.value];

        if (count <= 0) return null;

        return (
          <Badge
            key={option.value}
            variant="outline"
            className="font-normal text-muted-foreground"
          >
            {option.label} {count}
          </Badge>
        );
      })}
    </div>
  );
}
