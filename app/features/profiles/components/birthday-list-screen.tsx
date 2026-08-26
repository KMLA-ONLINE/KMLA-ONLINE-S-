import { CakeIcon } from "lucide-react";
import { Link } from "react-router";

import type { BirthdayProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function toUtcTime(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

function formatBirthdayDate(value: string) {
  return dateFormatter.format(new Date(toUtcTime(value)));
}

/** 오늘을 0으로 둔 날짜 차이. 양쪽 다 자정 UTC라 타임존·서머타임이 끼어들지 않는다. */
function dayGap(value: string, referenceDate: string) {
  return Math.round((toUtcTime(value) - toUtcTime(referenceDate)) / DAY_MS);
}

function formatDayGap(gap: number) {
  if (gap === 1) return "내일";
  if (gap === -1) return "어제";

  return gap > 0 ? `${gap}일 뒤` : `${-gap}일 전`;
}

interface BirthdayEntry {
  birthday: BirthdayProfile;
  gap: number;
}

function BirthdayRow({ birthday, gap }: BirthdayEntry) {
  const isToday = gap === 0;

  return (
    <Link
      to={`/profile/${birthday.pub_id}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
    >
      <UserAvatar
        src={birthday.avatar_url}
        name={birthday.name}
        className="size-10"
      />

      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {birthday.name}
      </span>

      {/* 날짜와 상대 표현을 오른쪽에 쌓아 둔다. 날짜만으로는 "며칠 남았는지"가 안 읽히고,
          상대 표현만으로는 정확한 날짜를 잃는다. */}
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <time
          dateTime={birthday.birthday_date}
          className={cn(
            "text-sm tabular-nums",
            isToday ? "font-medium" : "text-muted-foreground",
          )}
        >
          {formatBirthdayDate(birthday.birthday_date)}
        </time>

        {isToday ? (
          <span className="flex items-center gap-1 text-xs font-medium text-primary">
            <CakeIcon className="size-3" aria-hidden />
            오늘
          </span>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDayGap(gap)}
          </span>
        )}
      </div>
    </Link>
  );
}

function BirthdaySection({
  title,
  entries,
  highlight = false,
}: {
  title: string;
  entries: BirthdayEntry[];
  highlight?: boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-1.5 px-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">
          {title}
        </h2>

        <span className="text-xs text-muted-foreground/70 tabular-nums">
          {entries.length}
        </span>
      </div>

      <div
        className={cn(
          "divide-y overflow-hidden rounded-xl border bg-card",
          highlight && "border-primary/30 bg-primary/[0.04]",
        )}
      >
        {entries.map((entry) => (
          <BirthdayRow
            key={`${entry.birthday.pub_id}-${entry.birthday.birthday_date}`}
            birthday={entry.birthday}
            gap={entry.gap}
          />
        ))}
      </div>
    </section>
  );
}

export function BirthdayListScreen({
  birthdays,
  referenceDate,
}: {
  birthdays: BirthdayProfile[];
  referenceDate: string;
}) {
  const entries = birthdays.map((birthday) => ({
    birthday,
    gap: dayGap(birthday.birthday_date, referenceDate),
  }));

  const today = entries.filter((entry) => entry.gap === 0);
  const upcoming = entries.filter((entry) => entry.gap > 0);

  // 지난 생일은 최근 순으로 뒤집는다. RPC는 오름차순이라 그대로 두면 한 달 전이 맨 위에 온다.
  const past = entries.filter((entry) => entry.gap < 0).reverse();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-10 md:px-0">
      <h1 className="hidden text-2xl font-semibold md:block">생일</h1>

      {entries.length > 0 ? (
        <>
          <BirthdaySection title="오늘" entries={today} highlight />
          <BirthdaySection title="다가오는 생일" entries={upcoming} />
          <BirthdaySection title="지난 생일" entries={past} />
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16">
          <CakeIcon className="size-8 text-muted-foreground/50" aria-hidden />

          <p className="text-center text-sm text-muted-foreground">
            이 기간에 예정된 생일이 없습니다.
          </p>
        </div>
      )}
    </main>
  );
}
