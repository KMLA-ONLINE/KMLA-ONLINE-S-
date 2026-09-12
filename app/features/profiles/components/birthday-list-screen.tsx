import { CakeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { createProfileMediaUrls } from "~/features/profiles/data/media";
import { formatCohort } from "~/features/profiles/model/format";
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

const monthFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  timeZone: "UTC",
});

function toUtcTime(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

function formatBirthdayDate(value: string) {
  return dateFormatter.format(new Date(toUtcTime(value)));
}

function formatBirthdayMonth(value: string) {
  return monthFormatter.format(new Date(toUtcTime(value)));
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

function closestBirthdayGap(
  birthday: BirthdayCalendarProfile,
  referenceDate: string,
) {
  return [-1, 0, 1]
    .map((yearOffset) =>
      dayGap(toBirthdayDate(birthday, yearOffset), referenceDate),
    )
    .reduce((closest, gap) => {
      const distance = Math.abs(gap);
      const closestDistance = Math.abs(closest);

      // 윤년의 정확히 반년 지점은 다가오는 생일을 우선한다.
      return distance < closestDistance ||
        (distance === closestDistance && gap > closest)
        ? gap
        : closest;
    });
}

interface BirthdayEntry {
  birthday: BirthdayCalendarProfile;
  birthdayDate: string;
  index: number;
}

type BirthdayCycleItem =
  | {
      kind: "month";
      birthday: BirthdayCalendarProfile;
      index: number;
    }
  | ({ kind: "birthday" } & BirthdayEntry);

type BirthdayListItem =
  | {
      kind: "month";
      birthdayDate: string;
      index: number;
    }
  | ({ kind: "birthday" } & BirthdayEntry);

type BirthdayFilter = "all" | "teacher" | number;

interface BirthdayFilterOption {
  id: BirthdayFilter;
  label: string;
}

function BirthdayRow({
  birthday,
  birthdayDate,
  avatarUrl,
  referenceDate,
}: BirthdayEntry & { avatarUrl: string | null; referenceDate: string }) {
  const gap = closestBirthdayGap(birthday, referenceDate);
  const isToday = gap === 0;
  const cohort = formatCohort(birthday.cohort, birthday.is_returning_student);

  return (
    <Link
      to={`/profile/${birthday.pub_id}`}
      className="flex h-16 items-center gap-3 border-b px-4 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
    >
      <UserAvatar src={avatarUrl} name={birthday.name} className="size-10" />

      {cohort ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {cohort}
        </span>
      ) : null}

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

function birthdayCycleItems(birthdays: BirthdayCalendarProfile[]) {
  const items: BirthdayCycleItem[] = [];
  let previousMonth: number | null = null;

  birthdays.forEach((birthday, index) => {
    if (birthday.birthday_month !== previousMonth) {
      items.push({ kind: "month", birthday, index });
      previousMonth = birthday.birthday_month;
    }

    items.push({
      kind: "birthday",
      birthday,
      birthdayDate: birthday.birthday_date,
      index,
    });
  });

  return items;
}

function birthdayListItems(
  cycleItems: BirthdayCycleItem[],
  start: number,
  end: number,
  cycleOffset: number,
): BirthdayListItem[] {
  const totalItems = cycleItems.length * 2;
  const itemStart = Math.max(0, start);
  const itemEnd = Math.min(end, totalItems);

  return Array.from(
    { length: Math.max(0, itemEnd - itemStart) },
    (_, offset) => {
      const index = itemStart + offset;
      const cycleItem = cycleItems[index % cycleItems.length];
      const yearOffset = cycleOffset + Math.floor(index / cycleItems.length);
      const birthdayDate = toBirthdayDate(cycleItem.birthday, yearOffset);

      return cycleItem.kind === "month"
        ? { kind: "month", birthdayDate, index }
        : {
            kind: "birthday",
            birthday: cycleItem.birthday,
            birthdayDate,
            index,
          };
    },
  );
}

function birthdayFilterOptions(birthdays: BirthdayCalendarProfile[]) {
  const cohorts = new Set<number>();
  let hasTeacher = false;

  birthdays.forEach((birthday) => {
    if (birthday.cohort === null) {
      hasTeacher = true;
      return;
    }

    cohorts.add(birthday.cohort);
    if (birthday.is_returning_student) cohorts.add(birthday.cohort + 1);
  });

  const options: BirthdayFilterOption[] = [{ id: "all", label: "전체" }];

  Array.from(cohorts)
    .sort((left, right) => left - right)
    .forEach((cohort) => {
      options.push({ id: cohort, label: `${cohort}기` });
    });

  if (hasTeacher) options.push({ id: "teacher", label: "교사" });

  return options;
}

function matchesBirthdayFilter(
  birthday: BirthdayCalendarProfile,
  filter: BirthdayFilter,
) {
  if (filter === "all") return true;
  if (filter === "teacher") return birthday.cohort === null;
  if (birthday.cohort === filter) return true;

  return (
    birthday.is_returning_student &&
    birthday.cohort !== null &&
    birthday.cohort + 1 === filter
  );
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
  const [selectedFilter, setSelectedFilter] = useState<BirthdayFilter>("all");
  const filters = birthdayFilterOptions(birthdays);
  const filteredBirthdays = birthdays.filter((birthday) =>
    matchesBirthdayFilter(birthday, selectedFilter),
  );
  const cycleItems = birthdayCycleItems(filteredBirthdays);
  const [visibleRange, setVisibleRange] = useState({
    start: 0,
    end: BIRTHDAY_OVERSCAN * 2,
  });
  const [avatarUrls, setAvatarUrls] = useState<Map<string, string>>(
    () => new Map(),
  );
  const totalRows = cycleItems.length * 2;
  const isVirtualized = scrollRef !== null;
  const items = isVirtualized
    ? birthdayListItems(
        cycleItems,
        visibleRange.start,
        visibleRange.end,
        cycleOffset,
      )
    : birthdayListItems(cycleItems, 0, cycleItems.length, 0);
  const visiblePathsKey = Array.from(
    new Set(
      items.flatMap((item) =>
        item.kind === "birthday" && item.birthday.avatar_path
          ? [item.birthday.avatar_path]
          : [],
      ),
    ),
  ).join("\n");

  useEffect(() => {
    const container = scrollRef?.current;
    const list = listRef.current;
    if (!container || !list || cycleItems.length === 0) return;

    const cycleHeight = cycleItems.length * BIRTHDAY_ROW_HEIGHT;
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
  }, [cycleItems.length, scrollRef, totalRows]);

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

  const selectFilter = (filter: BirthdayFilter) => {
    if (filter === selectedFilter) return;

    const container = scrollRef?.current;
    const list = listRef.current;

    if (container && list) {
      container.scrollTo({
        top:
          container.scrollTop +
          list.getBoundingClientRect().top -
          container.getBoundingClientRect().top,
      });
    }

    cycleOffsetRef.current = 0;
    setCycleOffset(0);
    setVisibleRange({ start: 0, end: BIRTHDAY_OVERSCAN * 2 });
    setSelectedFilter(filter);
  };

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-2 pb-10 md:px-0">
      <h1 className="hidden text-2xl font-semibold md:block">생일</h1>

      {birthdays.length > 0 ? (
        <section className="flex flex-col">
          <div
            role="group"
            aria-label="기수 필터"
            className="mx-1 flex overflow-x-auto overflow-y-hidden border-b md:mx-0 md:px-0"
          >
            {filters.map((filter) => {
              const selected = filter.id === selectedFilter;

              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => selectFilter(filter.id)}
                  className={cn(
                    "-mb-px inline-flex min-h-11 shrink-0 touch-manipulation items-center border-b-2 px-4 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    selected
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          <div
            ref={listRef}
            role="list"
            className="relative overflow-hidden"
            style={
              isVirtualized
                ? { height: `${totalRows * BIRTHDAY_ROW_HEIGHT}px` }
                : undefined
            }
          >
            {items.map((item) => (
              <div
                key={`${cycleOffset}-${item.kind}-${item.index}`}
                role={item.kind === "birthday" ? "listitem" : undefined}
                className={isVirtualized ? "absolute inset-x-0" : undefined}
                style={
                  isVirtualized
                    ? {
                        transform: `translateY(${item.index * BIRTHDAY_ROW_HEIGHT}px)`,
                      }
                    : undefined
                }
              >
                {item.kind === "month" ? (
                  <div className="flex h-16 items-end border-b px-1 pb-2">
                    <h3 className="text-md font-semibold">
                      {formatBirthdayMonth(item.birthdayDate)}
                    </h3>
                  </div>
                ) : (
                  <BirthdayRow
                    {...item}
                    avatarUrl={
                      avatarUrls.get(item.birthday.avatar_path) ?? null
                    }
                    referenceDate={referenceDate}
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="flex flex-col items-center gap-3 border-y border-dashed py-16">
          <CakeIcon className="size-8 text-muted-foreground/50" aria-hidden />

          <p className="text-center text-sm text-muted-foreground">
            등록된 생일이 없습니다.
          </p>
        </div>
      )}
    </main>
  );
}
