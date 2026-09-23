import { CakeIcon, ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";

import type { BirthdayProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";

export function HomeBirthdaySummary({
  birthdays,
}: {
  birthdays: BirthdayProfile[];
}) {
  if (birthdays.length === 0) return null;

  return (
    <section className="rounded-xl border bg-card">
      <Link
        to="/menu/birthdays"
        className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <div className="flex items-center gap-2">
          <CakeIcon className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold">오늘의 생일</h2>
        </div>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>

      <div className="flex flex-col divide-y border-t">
        {birthdays.map((birthday) => (
          <Link
            key={birthday.pub_id}
            to={`/profile/${birthday.pub_id}`}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
          >
            <UserAvatar
              src={birthday.avatar_url}
              name={birthday.name}
              className="size-8"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {birthday.name}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
