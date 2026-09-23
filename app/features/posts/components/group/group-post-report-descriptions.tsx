import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type {
  GroupPostReportDescriptionCursor,
  GroupPostReportDescriptionPage,
} from "~/features/posts/data/group-reports";
import { getGroupPostReportReasonLabel } from "~/features/posts/model/group-report";
import { RelativeTime } from "~/shared/components/relative-time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

export function GroupPostReportDescriptions({
  groupId,
  postId,
  count,
}: {
  groupId: string;
  postId: string;
  count: number;
}) {
  const fetcher = useFetcher<GroupPostReportDescriptionPage>();

  const [open, setOpen] = useState(false);

  const [pages, setPages] = useState<GroupPostReportDescriptionPage[]>([]);

  const processed = useRef(fetcher.data);

  useEffect(() => {
    if (!fetcher.data || processed.current === fetcher.data) {
      return;
    }

    processed.current = fetcher.data;

    setPages((current) => [...current, fetcher.data!]);
  }, [fetcher.data]);

  const nextCursor = pages.at(-1)?.nextCursor ?? null;

  const load = (cursor?: GroupPostReportDescriptionCursor | null) => {
    if (fetcher.state !== "idle") {
      return;
    }

    const next = new URLSearchParams({
      mode: "descriptions",
      groupId,
      postId,
    });

    if (cursor) {
      next.set("beforeCreatedAt", cursor.createdAt);
      next.set("beforeReportId", String(cursor.reportId));
    }

    void fetcher.load(`/groups/report-page?${next}`);
  };

  const toggle = () => {
    const nextOpen = !open;

    setOpen(nextOpen);

    if (nextOpen && pages.length === 0) {
      load();
    }
  };

  const descriptions = pages.flatMap((page) => page.descriptions);

  // 토글과 펼친 목록을 형제로 내보낸다. 부모(신고 카드 footer)가 `flex flex-wrap`이므로
  // 목록은 `order-last basis-full`로 다른 액션 아래 한 줄을 통째로 차지한다.
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        aria-expanded={open}
        onClick={toggle}
      >
        설명 {count}
        <ChevronDownIcon
          data-icon="inline-end"
          className={
            open ? "rotate-180 transition-transform" : "transition-transform"
          }
        />
      </Button>

      {open ? (
        <div className="order-last mt-1 w-full basis-full rounded-md bg-muted/40 p-2">
          {descriptions.map((description) => (
            <div key={description.report_id} className="py-1.5">
              <div className="mb-0.5 flex items-center gap-1.5">
                <Badge variant="outline" className="font-normal">
                  {getGroupPostReportReasonLabel(description.reason)}
                </Badge>

                <span className="text-xs text-muted-foreground">
                  <RelativeTime value={description.created_at} />
                </span>
              </div>

              <p className="text-sm leading-5 break-words whitespace-pre-wrap">
                {description.description}
              </p>
            </div>
          ))}

          {fetcher.state !== "idle" && descriptions.length === 0 ? (
            <div className="flex h-12 items-center justify-center">
              <Spinner aria-label="설명 불러오는 중" />
            </div>
          ) : null}

          {nextCursor ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 w-full"
              disabled={fetcher.state !== "idle"}
              onClick={() => load(nextCursor)}
            >
              {fetcher.state !== "idle" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              더 보기
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
