import { useEffect, useRef, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";

import { GroupPostReportCard } from "~/features/posts/components/group-post-report-card";
import type {
  GroupPostReportSummary,
  GroupPostReportSummaryPage,
} from "~/features/posts/data/group-reports";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { useInfiniteScroll } from "~/shared/hooks/use-infinite-scroll";
import { cn } from "~/shared/lib/utils";
import { Spinner } from "~/shared/ui/spinner";

export function GroupPostReportsPanel({
  groupId,
  slug,
  initialPage,
  canDelete,
  alwaysAnonymous,
}: {
  groupId: string;
  slug: string;
  initialPage: GroupPostReportSummaryPage;
  canDelete: boolean;
  alwaysAnonymous: boolean;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = searchParams.get("reportSort") === "recent" ? "recent" : "count";

  const pageFetcher = useFetcher<GroupPostReportSummaryPage>();

  const deleteFetcher = useFetcher<{
    error?: string;
    ok?: boolean;
  }>();

  const [pagination, setPagination] = useState({
    initialPage,
    additionalPages: [] as GroupPostReportSummaryPage[],
  });

  const processedData = useRef(pageFetcher.data);

  const [deleteTarget, setDeleteTarget] =
    useState<GroupPostReportSummary | null>(null);

  useEffect(() => {
    if (!pageFetcher.data || processedData.current === pageFetcher.data) {
      return;
    }

    processedData.current = pageFetcher.data;

    setPagination((current) => ({
      initialPage,
      additionalPages:
        current.initialPage === initialPage
          ? [...current.additionalPages, pageFetcher.data!]
          : [pageFetcher.data!],
    }));
  }, [initialPage, pageFetcher.data]);

  const pages = [
    initialPage,
    ...(pagination.initialPage === initialPage
      ? pagination.additionalPages
      : []),
  ];

  const reports = pages.flatMap((page) => page.reports);

  const nextCursor = pages.at(-1)?.nextCursor ?? null;

  const loadMore = () => {
    if (!nextCursor || pageFetcher.state !== "idle") {
      return;
    }

    const next = new URLSearchParams({
      mode: "summaries",
      groupId,
      sort,
      afterCount: String(nextCursor.reportCount),
      afterLatestAt: nextCursor.latestAt,
      afterPostId: nextCursor.postId,
    });

    void pageFetcher.load(`/groups/report-page?${next}`);
  };

  const sentinelRef = useInfiniteScroll(loadMore, {
    enabled: Boolean(nextCursor),
    pending: pageFetcher.state !== "idle",
  });

  const changeSort = (nextSort: "count" | "recent") => {
    if (nextSort === sort) return;

    const next = new URLSearchParams(searchParams);

    next.set("tab", "reports");

    if (nextSort === "count") {
      next.delete("reportSort");
    } else {
      next.set("reportSort", "recent");
    }

    setSearchParams(next, {
      preventScrollReset: true,
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end px-3 pb-1 md:px-0">
        <div className="inline-flex rounded-md bg-muted p-0.5">
          <button
            type="button"
            onClick={() => changeSort("count")}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-medium transition-colors",
              sort === "count"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground",
            )}
          >
            신고 수
          </button>

          <button
            type="button"
            onClick={() => changeSort("recent")}
            className={cn(
              "h-8 rounded-md px-3 text-xs font-medium transition-colors",
              sort === "recent"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground",
            )}
          >
            최근
          </button>
        </div>
      </div>

      {deleteFetcher.data?.error ? (
        <p role="alert" className="px-4 text-xs text-destructive md:px-0">
          {deleteFetcher.data.error}
        </p>
      ) : null}

      {reports.length === 0 ? (
        <div className="bg-card px-4 py-12 text-center text-sm text-muted-foreground md:rounded-md">
          신고된 게시물이 없습니다.
        </div>
      ) : (
        reports.map((report) => (
          <GroupPostReportCard
            key={report.post_id}
            report={report}
            groupId={groupId}
            slug={slug}
            alwaysAnonymous={alwaysAnonymous}
            canDelete={canDelete}
            onDelete={() => setDeleteTarget(report)}
          />
        ))
      )}

      <div
        ref={sentinelRef}
        className="flex min-h-10 items-center justify-center"
        aria-live="polite"
      >
        {pageFetcher.state !== "idle" ? (
          <Spinner aria-label="신고 불러오는 중" />
        ) : null}
      </div>

      {deleteTarget ? (
        <ConfirmDialog
          title="게시물을 삭제할까요?"
          description="게시물과 신고 기록이 함께 제거됩니다."
          confirmLabel="삭제"
          destructive
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            void deleteFetcher.submit(
              {
                intent: "delete-post",
                postId: deleteTarget.post_id,
              },
              { method: "post" },
            );

            setDeleteTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
