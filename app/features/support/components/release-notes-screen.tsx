import { SparklesIcon } from "lucide-react";

import { Badge } from "~/shared/ui/badge";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "~/shared/ui/empty";
import type { Release, ReleaseChangeKind } from "../model/types";

/**
 * 변경 종류별 꼬리표. 세 종류를 같은 색으로 두면 결국 글자를 읽어야 하므로, 눈으로 훑을 수
 * 있게 색을 나눈다. 새 색을 만들지 않고 기존 Badge variant만 쓴다.
 */
const CHANGE_BADGE = {
  added: { label: "추가", variant: "default" },
  fixed: { label: "수정", variant: "secondary" },
  deleted: { label: "제거", variant: "destructive" },
} as const satisfies Record<
  ReleaseChangeKind,
  { label: string; variant: "default" | "secondary" | "destructive" }
>;

const DATE_FORMAT = new Intl.DateTimeFormat("ko", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * `YYYY-MM-DD`를 "2026년 8월 31일"로.
 *
 * `new Date("2026-08-31")`은 UTC 자정으로 읽혀서 UTC보다 서쪽에 있는 기기에서는 하루 전으로
 * 표시된다. 달력 날짜에 시간대를 개입시키지 않으려고 숫자에서 직접 만든다.
 */
function formatReleaseDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;

  return DATE_FORMAT.format(new Date(year, month - 1, day));
}

export function ReleaseNotesScreen({ releases }: { releases: Release[] }) {
  // 콘텐츠 파일은 최신이 위에 오도록 쓰지만, 한 항목이 잘못 끼어도 화면 순서는 흔들리지
  // 않아야 한다. ISO 날짜라 사전순 정렬이 곧 시간순이다.
  const ordered = [...releases].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-0">
      <h1 className="hidden text-2xl font-semibold md:block">업데이트 기록</h1>

      {ordered.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SparklesIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>아직 기록된 업데이트가 없어요</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col gap-3">
          {ordered.map((release) => (
            <li key={`${release.date}-${release.title}`}>
              <article className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <time
                    dateTime={release.date}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {formatReleaseDate(release.date)}
                  </time>

                  {release.version ? (
                    <Badge variant="outline">{release.version}</Badge>
                  ) : null}
                </div>

                <h2 className="mt-1 font-semibold break-keep">
                  {release.title}
                </h2>

                <ul className="mt-3 flex flex-col gap-2">
                  {release.changes.map((change) => {
                    const badge = CHANGE_BADGE[change.kind];

                    return (
                      <li key={change.text} className="flex gap-2.5">
                        {/* 꼬리표 높이가 글자 한 줄보다 낮아서, 여러 줄로 넘어가는
                            문장에서도 첫 줄에 맞도록 살짝 내린다. */}
                        <Badge variant={badge.variant} className="mt-0.5">
                          {badge.label}
                        </Badge>

                        <span className="min-w-0 flex-1 text-sm leading-relaxed text-muted-foreground">
                          {change.text}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
