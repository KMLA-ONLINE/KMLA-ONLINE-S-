import { useEffect, useState } from "react";
import { Link } from "react-router";

import { loadTimetableRecord } from "~/features/timetable/data/timetable";
import {
  COLORS,
  PERIODS,
  emptyTimetable,
  getKoreaWeekday,
  timetableFromStored,
} from "~/features/timetable/model/timetable";
import { loadCachedTimetable } from "~/features/timetable/storage/timetable-storage";
import { cn } from "~/shared/lib/utils";
import { Skeleton } from "~/shared/ui/skeleton";

export interface HomeTimetableSummaryProps {
  profileId: number;
}

/** Mount behind the app's account-storage gate; desktop visibility belongs to the parent. */
export function HomeTimetableSummary({ profileId }: HomeTimetableSummaryProps) {
  return <AccountTimetableSummary key={profileId} profileId={profileId} />;
}

function AccountTimetableSummary({ profileId }: HomeTimetableSummaryProps) {
  const [timetable, setTimetable] = useState(loadCachedTimetable);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const today = getKoreaWeekday();
  const courses = timetable
    ? timetable.semesters[timetable.activeSemester]
    : [];

  useEffect(() => {
    let cancelled = false;
    void loadTimetableRecord(profileId)
      .then((stored) => {
        if (!cancelled) {
          setTimetable(
            stored
              ? timetableFromStored(stored.activeSemester, stored.semesters)
              : (loadCachedTimetable() ?? emptyTimetable()),
          );
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  return (
    <Link
      to="/menu/timetable"
      aria-label="시간표 보기"
      className="block min-w-0 overflow-hidden rounded-md p-2 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <div>
        {failed && today !== null ? (
          <p role="alert" className="mb-3 text-sm text-muted-foreground">
            시간표를 불러오지 못했습니다.
            {timetable
              ? " 기기에 저장된 시간표를 표시합니다."
              : " 잠시 후 다시 확인해 주세요."}
          </p>
        ) : null}
        {today === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            주말에는 시간표가 없습니다
          </p>
        ) : !timetable && loading ? (
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">시간표를 불러오는 중</span>
            <Skeleton className="h-96 w-full" />
          </div>
        ) : timetable ? (
          <table
            aria-label="오늘의 시간표"
            className="w-full table-fixed border-collapse text-xs"
          >
            <tbody>
              {PERIODS.map(({ period, start }) => {
                const course = courses.find((item) =>
                  item.meetings.some(
                    (meeting) =>
                      meeting.day === today &&
                      meeting.start <= period &&
                      meeting.end >= period,
                  ),
                );
                return (
                  <tr key={period} className="h-12 border-b last:border-b-0">
                    <th
                      scope="row"
                      className="w-14 border-r pr-2 text-center font-normal"
                    >
                      <span className="block font-semibold">{period}교시</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {start}
                      </span>
                    </th>
                    <td
                      className={cn(
                        "px-2 py-1",
                        course && COLORS[course.color % COLORS.length],
                      )}
                    >
                      {course ? (
                        <>
                          <span className="block font-semibold break-words">
                            {course.name}
                          </span>
                          <span className="block text-[10px] break-words opacity-70">
                            {course.room}
                          </span>
                        </>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </Link>
  );
}
