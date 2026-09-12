import { CakeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { createProfileMediaUrls } from "~/features/profiles/data/media";
import type { BirthdayCalendarProfile } from "~/features/profiles/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { useScrollContainer } from "~/shared/lib/scroll-container";
import { cn } from "~/shared/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const BIRTHDAY_ROW_HEIGHT = 64;
const BIRTHDAY_OVERSCAN = 12;

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

function toBirthdayDate(birthday: BirthdayCalendarProfile, yearOffset: number) {
  const year = Number(birthday.birthday_date.slice(0, 4)) + yearOffset;
  const lastDay = new Date(
    Date.UTC(year, birthday.birthday_month, 0),
  ).getUTCDate();
  const month = String(birthday.birthday_month).padStart(2, "0");
  const day = String(Math.min(birthday.birthday_day, lastDay)).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

interface BirthdayEntry {
  birthday: BirthdayCalendarProfile;
  birthdayDate: string;
  index: number;
}

function BirthdayRow({
  birthday,
  birthdayDate,
  avatarUrl,
  referenceDate,
}: BirthdayEntry & { avatarUrl: string | null; referenceDate: string }) {
  const gap = dayGap(birthdayDate, referenceDate);
  const isToday = gap === 0;

  return (
    <Link
      to={`/profile/${birthday.pub_id}`}
      className="flex h-16 items-center gap-3 border-b px-4 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
    >
      <UserAvatar src={avatarUrl} name={birthday.name} className="size-10" />

      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {birthday.name}
      </span>

      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <time
          dateTime={birthdayDate}
          className={cn(
            "text-sm tabular-nums",
            isToday ? "font-medium" : "text-muted-foreground",
          )}
        >
          {formatBirthdayDate(birthdayDate)}
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

function birthdayEntries(
  birthdays: BirthdayCalendarProfile[],
  start: number,
  end: number,
  cycleOffset: number,
) {
  return Array.from({ length: end - start }, (_, offset) => {
    const index = start + offset;
    const birthday = birthdays[index % birthdays.length];
    const yearOffset = cycleOffset + Math.floor(index / birthdays.length);

    return {
      birthday,
      birthdayDate: toBirthdayDate(birthday, yearOffset),
      index,
    };
  });
}

export function BirthdayListScreen({
  birthdays,
  referenceDate,
}: {
  birthdays: BirthdayCalendarProfile[];
  referenceDate: string;
}) {
  const scrollRef = useScrollContainer();
  const listRef = useRef<HTMLDivElement>(null);
  const cycleOffsetRef = useRef(0);
  const [cycleOffset, setCycleOffset] = useState(0);
  const [visibleRange, setVisibleRange] = useState({
    start: 0,
    end: Math.min(birthdays.length * 2, BIRTHDAY_OVERSCAN * 2),
  });
  const [avatarUrls, setAvatarUrls] = useState<Map<string, string>>(
    () => new Map(),
  );
  const totalRows = birthdays.length * 2;
  const isVirtualized = scrollRef !== null;
  const entries = isVirtualized
    ? birthdayEntries(
        birthdays,
        visibleRange.start,
        visibleRange.end,
        cycleOffset,
      )
    : birthdays.map((birthday, index) => ({
        birthday,
        birthdayDate: birthday.birthday_date,
        index,
      }));
  const visiblePathsKey = entries
    .map((entry) => entry.birthday.avatar_path)
    .join("\n");

  useEffect(() => {
    const container = scrollRef?.current;
    const list = listRef.current;
    if (!container || !list || birthdays.length === 0) return;

    const cycleHeight = birthdays.length * BIRTHDAY_ROW_HEIGHT;
    let frameId = 0;
    let lastTop = container.scrollTop;
    const listTop =
      container.scrollTop +
      list.getBoundingClientRect().top -
      container.getBoundingClientRect().top;

    const updateVisibleRange = (top: number) => {
      const firstVisible = Math.max(
        0,
        Math.floor((top - listTop) / BIRTHDAY_ROW_HEIGHT),
      );
      const visibleCount = Math.ceil(
        container.clientHeight / BIRTHDAY_ROW_HEIGHT,
      );
      const start = Math.max(0, firstVisible - BIRTHDAY_OVERSCAN);
      const end = Math.min(
        totalRows,
        firstVisible + visibleCount + BIRTHDAY_OVERSCAN,
      );

      setVisibleRange((current) =>
        current.start === start && current.end === end
          ? current
          : { start, end },
      );
    };

    const recenter = (direction: 1 | -1) => {
      const nextTop = container.scrollTop - direction * cycleHeight;
      cycleOffsetRef.current += direction;
      setCycleOffset(cycleOffsetRef.current);
      container.scrollTop = nextTop;
      lastTop = nextTop;
      updateVisibleRange(nextTop);
    };

    const update = () => {
      frameId = 0;
      const top = container.scrollTop;
      const delta = top - lastTop;
      lastTop = top;

      if (cycleHeight > container.clientHeight) {
        if (delta > 0 && top >= listTop + cycleHeight) {
          recenter(1);
          return;
        }

        if (delta < 0 && cycleOffsetRef.current > 0 && top <= listTop) {
          recenter(-1);
          return;
        }
      }

      updateVisibleRange(top);
    };

    const onScroll = () => {
      if (frameId === 0) frameId = window.requestAnimationFrame(update);
    };

    updateVisibleRange(container.scrollTop);
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
    };
  }, [birthdays.length, scrollRef, totalRows]);

  useEffect(() => {
    if (!isVirtualized || visiblePathsKey.length === 0) return;

    let active = true;
    void createProfileMediaUrls(visiblePathsKey.split("\n")).then((urls) => {
      if (!active) return;

      setAvatarUrls((current) => {
        let changed = false;
        const next = new Map(current);

        urls.forEach((url, path) => {
          if (next.get(path) === url) return;
          next.set(path, url);
          changed = true;
        });

        return changed ? next : current;
      });
    });

    return () => {
      active = false;
    };
  }, [isVirtualized, visiblePathsKey]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-10 md:px-0">
      <h1 className="hidden text-2xl font-semibold md:block">생일</h1>

      {birthdays.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-1.5 px-1">
            <h2 className="text-xs font-semibold tracking-wide text-muted-foreground">
              생일 순서
            </h2>

            <span className="text-xs text-muted-foreground/70 tabular-nums">
              {birthdays.length}
            </span>
          </div>

          <p className="px-1 text-sm text-muted-foreground">
            오늘부터 한 해 동안의 생일입니다. 끝까지 내리면 다음 해로
            이어집니다.
          </p>

          <div
            ref={listRef}
            role="list"
            className="relative overflow-hidden rounded-xl border bg-card"
            style={
              isVirtualized
                ? { height: `${totalRows * BIRTHDAY_ROW_HEIGHT}px` }
                : undefined
            }
          >
            {entries.map((entry) => (
              <div
                key={`${cycleOffset}-${entry.index}-${entry.birthday.pub_id}`}
                role="listitem"
                className={isVirtualized ? "absolute inset-x-0" : undefined}
                style={
                  isVirtualized
                    ? {
                        transform: `translateY(${entry.index * BIRTHDAY_ROW_HEIGHT}px)`,
                      }
                    : undefined
                }
              >
                <BirthdayRow
                  {...entry}
                  avatarUrl={avatarUrls.get(entry.birthday.avatar_path) ?? null}
                  referenceDate={referenceDate}
                />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16">
          <CakeIcon className="size-8 text-muted-foreground/50" aria-hidden />

          <p className="text-center text-sm text-muted-foreground">
            등록된 생일이 없습니다.
          </p>
        </div>
      )}
    </main>
  );
}
