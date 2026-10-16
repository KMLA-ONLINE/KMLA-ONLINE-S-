import { Link } from "react-router";

import type { BirthdayProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";

export function HomeBirthdaySummary({
  birthdays,
}: {
  birthdays: BirthdayProfile[] | null;
}) {
  return (
    <Link
      to="/menu/birthdays"
      aria-label="생일 보기"
      className="block min-w-0 overflow-hidden rounded-md p-2 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h2 className="mb-2 text-sm font-semibold">생일</h2>
      {birthdays === null ? (
        <p role="status" className="py-2 text-sm text-muted-foreground">
          생일 정보를 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.
        </p>
      ) : birthdays.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          오늘 생일인 사람이 없습니다
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto">
          {birthdays.map((birthday) => (
            <div
              key={birthday.pub_id}
              className="flex w-14 shrink-0 flex-col items-center gap-1.5 py-1"
            >
              <UserAvatar
                src={birthday.avatar_url}
                name={birthday.name}
                className="size-8"
              />
              <span className="w-full truncate text-center text-xs">
                {birthday.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

export function HomeBirthdaySummarySkeleton() {
  return (
    <PendingRegion label="생일을" className="min-w-0 p-2">
      <div aria-hidden="true">
        <div className="mb-2 flex h-5 items-center">
          <Skeleton className="h-4 w-10" />
        </div>
        <div className="flex gap-3">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="flex w-14 shrink-0 flex-col items-center gap-1.5 py-1"
            >
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-10" />
            </div>
          ))}
        </div>
      </div>
    </PendingRegion>
  );
}
