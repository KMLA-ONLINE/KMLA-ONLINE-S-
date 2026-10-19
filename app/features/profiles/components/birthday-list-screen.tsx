import { CakeIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

type BirthdayListItem =
  | {
      kind: "month";
      month: number;
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

/** 1월부터 12월까지 월 제목을 끼워 넣는다. `birthday_date`는 오늘 이후 다가오는 날이라 1월이 다음 해일 수 있다. */
function birthdayListItems(birthdays: BirthdayCalendarProfile[]) {
  const items: BirthdayListItem[] = [];
  let previousMonth: number | null = null;

  [...birthdays]
    .sort(
      (left, right) =>
        left.birthday_month - right.birthday_month ||
        left.birthday_day - right.birthday_day,
    )
    .forEach((birthday) => {
      if (birthday.birthday_month !== previousMonth) {
        items.push({
          kind: "month",
          month: birthday.birthday_month,
          birthdayDate: birthday.birthday_date,
          index: items.length,
        });
        previousMonth = birthday.birthday_month;
      }

      items.push({
        kind: "birthday",
        birthday,
        birthdayDate: birthday.birthday_date,
        index: items.length,
      });
    });

  return items;
}

/**
 * 목록에서 오늘의 자리. 오늘 생일인 사람이 있으면 그 첫 행이다. 없으면 오늘 뒤로 처음 오는
 * 행이고, 그 행이 다른 달의 첫 생일이면 그 달 제목이다. 뒤로 아무도 없으면 행 개수다.
 */
function todayPosition(items: BirthdayListItem[], referenceDate: string) {
  const month = Number(referenceDate.slice(5, 7));
  const day = Number(referenceDate.slice(8, 10));
  const todayRow = items.find(
    (item) =>
      item.kind === "birthday" &&
      closestBirthdayGap(item.birthday, referenceDate) === 0,
  );
  if (todayRow) return { index: todayRow.index, hasBirthday: true };

  const next = items.find(
    (item) =>
      item.kind === "birthday" &&
      (item.birthday.birthday_month > month ||
        (item.birthday.birthday_month === month &&
          item.birthday.birthday_day > day)),
  );
  if (next?.kind !== "birthday") {
    return { index: items.length, hasBirthday: false };
  }

  const previous = items[next.index - 1];
  const index =
    previous?.kind === "month" && next.birthday.birthday_month !== month
      ? previous.index
      : next.index;

  return { index, hasBirthday: false };
}

/**
 * 첫 화면의 맨 위 행. 오늘 생일이면 그 행, 아니면 오늘 표시선 바로 위 행이라 선이 보인다.
 * 이미 맨 앞이면 움직이지 않는다.
 */
function startRowIndex(position: { index: number; hasBirthday: boolean }) {
  const index = position.hasBirthday ? position.index : position.index - 1;

  return index <= 0 ? null : index;
}

function visibleRangeAround(index: number) {
  return {
    start: Math.max(0, index - BIRTHDAY_OVERSCAN),
    end: index + BIRTHDAY_OVERSCAN * 2,
  };
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
  const startMonthRef = useRef<HTMLDivElement>(null);
  const [selectedFilter, setSelectedFilter] = useState<BirthdayFilter>("all");
  const filters = useMemo(() => birthdayFilterOptions(birthdays), [birthdays]);
  // 스크롤할 때마다 보이는 범위가 바뀌어 다시 렌더된다. 학교 전체를 걸러 정렬하는 일을 그때마다 되풀이하지 않는다.
  const listItems = useMemo(
    () =>
      birthdayListItems(
        birthdays.filter((birthday) =>
          matchesBirthdayFilter(birthday, selectedFilter),
        ),
      ),
    [birthdays, selectedFilter],
  );
  const today = useMemo(
    () => todayPosition(listItems, referenceDate),
    [listItems, referenceDate],
  );
  // 첫 화면은 오늘 자리에서 시작한다. 그 행이 처음부터 그려져 있어야 위치를 잴 수 있다.
  const [startIndex] = useState(() => startRowIndex(today));
  const [visibleRange, setVisibleRange] = useState(() =>
    visibleRangeAround(startIndex ?? 0),
  );
  const [avatarUrls, setAvatarUrls] = useState<Map<string, string>>(
    () => new Map(),
  );
  const totalRows = listItems.length;
  const isVirtualized = scrollRef !== null;
  const items = isVirtualized
    ? listItems.slice(visibleRange.start, visibleRange.end)
    : listItems;
  const visiblePathsKey = Array.from(
    new Set(
      items.flatMap((item) =>
        item.kind === "birthday" && item.birthday.avatar_path
          ? [item.birthday.avatar_path]
          : [],
      ),
    ),
  ).join("\n");

  // 셸의 위치 복원(layout effect)이 끝난 뒤에 돈다. 뒤로 가기로 돌아와 보던 위치가 되살아났다면
  // 그대로 둔다.
  useEffect(() => {
    const container = scrollRef?.current;
    const month = startMonthRef.current;
    if (!container || !month || container.scrollTop !== 0) return;

    container.scrollTo({
      top:
        month.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        Number.parseFloat(getComputedStyle(month).scrollMarginTop || "0"),
    });
  }, [scrollRef]);

  useEffect(() => {
    const container = scrollRef?.current;
    const list = listRef.current;
    if (!container || !list || totalRows === 0) return;

    let frameId = 0;

    const update = () => {
      frameId = 0;
      const listTop =
        list.getBoundingClientRect().top -
        container.getBoundingClientRect().top;
      const firstVisible = Math.max(
        0,
        Math.floor(-listTop / BIRTHDAY_ROW_HEIGHT),
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

    const onScroll = () => {
      if (frameId === 0) frameId = window.requestAnimationFrame(update);
    };

    update();
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
    };
  }, [scrollRef, totalRows]);

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

    setVisibleRange(visibleRangeAround(0));
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
                key={`${item.kind}-${item.index}`}
                // 번호는 처음 목록(전체) 기준이다. 필터를 바꾸면 같은 번호가 다른 행이므로 붙이지 않는다.
                ref={
                  selectedFilter === "all" && item.index === startIndex
                    ? startMonthRef
                    : undefined
                }
                role={item.kind === "birthday" ? "listitem" : undefined}
                className={cn(
                  isVirtualized ? "absolute inset-x-0" : "relative",
                  // 모바일 PageHeader에 가리지 않게 첫 위치를 그만큼 내린다.
                  "scroll-mt-[calc(var(--app-page-header-h)+var(--app-safe-t))] md:scroll-mt-0",
                )}
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

                {/* 오늘 생일인 사람이 없으면 오늘이 들어갈 행 경계에 선을 긋는다. */}
                {!today.hasBirthday &&
                (item.index === today.index ||
                  (today.index === totalRows &&
                    item.index === totalRows - 1)) ? (
                  <div
                    data-testid="birthday-today-marker"
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary",
                      item.index === today.index
                        ? "top-0 -translate-y-1/2"
                        : "bottom-0 translate-y-1/2",
                    )}
                  >
                    <span className="absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full bg-primary" />
                  </div>
                ) : null}
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
