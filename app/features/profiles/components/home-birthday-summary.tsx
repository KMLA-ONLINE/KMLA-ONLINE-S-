import { Link } from "react-router";

import type { BirthdayProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";

export function HomeBirthdaySummary({
  birthdays,
}: {
  birthdays: BirthdayProfile[];
}) {
  return (
    <Link
      to="/menu/birthdays"
      aria-label="생일 보기"
      className="block min-w-0 overflow-hidden rounded-md p-2 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h2 className="mb-2 text-sm font-semibold">생일</h2>
      {birthdays.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">
          오늘 생일인 학생이 없습니다
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
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
