import { useState } from "react";

import { cn } from "~/shared/lib/utils";

import { getDefaultMeal, getMealDay, type MealDay } from "../data/neis";

const MEALS = [
  { api: "조식", label: "아침" },
  { api: "중식", label: "점심" },
  { api: "석식", label: "저녁" },
] as const;

const SKELETON_WIDTHS = ["w-24", "w-32", "w-28", "w-36", "w-20", "w-16"];

const weekdayFormatter = new Intl.DateTimeFormat("ko-KR", {
  weekday: "short",
  timeZone: "UTC",
});

const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  weekday: "long",
  timeZone: "UTC",
});

function toDate(date: string) {
  return new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(4, 6)) - 1,
      Number(date.slice(6, 8)),
    ),
  );
}

function dayNumber(date: string) {
  return String(Number(date.slice(6, 8)));
}

/** 모바일에선 카드가 없으므로 회색 블록 대신 줄 단위로 비운다. */
function MealSkeleton() {
  return (
    <div className="px-1 md:px-4">
      {SKELETON_WIDTHS.map((width) => (
        <div key={width} className="py-2.5">
          <div className={cn("h-4 animate-pulse rounded bg-muted", width)} />
        </div>
      ))}
    </div>
  );
}

function MealNotice({ children }: { children: string }) {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

interface MealScreenProps {
  dates: string[];
  initialDate: string;
  initialDay: MealDay;
}

export function MealScreen({
  dates,
  initialDate,
  initialDay,
}: MealScreenProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate);

  const [selectedMeal, setSelectedMeal] = useState(getDefaultMeal);

  const [days, setDays] = useState<Record<string, MealDay>>({
    [initialDay.date]: initialDay,
  });

  const [loadingDate, setLoadingDate] = useState<string | null>(null);

  const selectedDay = days[selectedDate];

  const activeMeal = selectedDay?.meals.find(
    (meal) => meal.label === selectedMeal,
  );

  const selectDate = async (date: string) => {
    setSelectedDate(date);

    if (days[date]) return;

    setLoadingDate(date);

    const day = await getMealDay(date);

    setDays((current) => ({
      ...current,
      [date]: day,
    }));

    setLoadingDate((current) => (current === date ? null : current));
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-10 md:px-0">
      <div className="grid grid-cols-7">
        {dates.map((dateValue) => {
          const date = toDate(dateValue);
          const selected = dateValue === selectedDate;

          return (
            <button
              key={dateValue}
              type="button"
              aria-label={fullDateFormatter.format(date)}
              aria-pressed={selected}
              onClick={() => void selectDate(dateValue)}
              className="flex touch-manipulation flex-col items-center gap-1 rounded-xl py-1.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span
                className={cn(
                  "text-xs transition-colors",
                  selected ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {weekdayFormatter.format(date).replace(".", "")}
              </span>

              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums transition-colors",
                  selected && "bg-primary text-primary-foreground",
                )}
              >
                {dayNumber(dateValue)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex border-b">
        {MEALS.map((meal) => {
          const selected = selectedMeal === meal.api;

          return (
            <button
              key={meal.api}
              type="button"
              aria-pressed={selected}
              onClick={() => setSelectedMeal(meal.api)}
              className={cn(
                "-mb-px min-h-11 flex-1 touch-manipulation border-b-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                selected
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {meal.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 md:mt-4">
        {loadingDate === selectedDate ? (
          <MealSkeleton />
        ) : selectedDay?.unavailable ? (
          <MealNotice>불러오지 못했습니다</MealNotice>
        ) : activeMeal ? (
          <ul className="md:rounded-2xl md:border md:bg-card md:py-2">
            {activeMeal.items.map((item) => (
              <li
                key={`${item.name}-${item.allergens.join(".")}`}
                className="px-1 py-2.5 text-[15px] leading-6 md:px-5"
              >
                {item.name}
              </li>
            ))}
          </ul>
        ) : selectedDay ? (
          <MealNotice>식단 없음</MealNotice>
        ) : (
          <MealSkeleton />
        )}
      </div>
    </div>
  );
}
