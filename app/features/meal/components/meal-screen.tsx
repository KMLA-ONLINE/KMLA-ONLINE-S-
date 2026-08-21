import { useState } from "react";

import { cn } from "~/shared/lib/utils";

import { getDefaultMeal, getMealDay, type MealDay } from "../data/neis";

const MEALS = [
  { api: "조식", label: "아침" },
  { api: "중식", label: "점심" },
  { api: "석식", label: "저녁" },
] as const;

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
    <div className="mx-auto w-full max-w-2xl px-3 pb-8 md:px-0">
      <div className="space-y-3">
        <div className="grid grid-cols-7 gap-1 rounded-2xl bg-muted p-1">
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
                className={cn(
                  "flex min-h-12 touch-manipulation flex-col items-center justify-center rounded-xl px-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="text-[11px] font-medium sm:text-xs">
                  {weekdayFormatter.format(date).replace(".", "")}
                </span>

                <span className="mt-0.5 text-sm font-semibold tabular-nums">
                  {dayNumber(dateValue)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-3 rounded-2xl bg-muted p-1">
          {MEALS.map((meal) => {
            const selected = selectedMeal === meal.api;

            return (
              <button
                key={meal.api}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedMeal(meal.api)}
                className={cn(
                  "min-h-11 touch-manipulation rounded-xl px-3 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected
                    ? "bg-background text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {meal.label}
              </button>
            );
          })}
        </div>

        {loadingDate === selectedDate ? (
          <div className="h-52 animate-pulse rounded-2xl bg-muted" />
        ) : selectedDay?.unavailable ? (
          <div className="rounded-2xl border bg-card py-12 text-center text-sm text-muted-foreground">
            불러오지 못했습니다
          </div>
        ) : activeMeal ? (
          <section className="overflow-hidden rounded-2xl border bg-card">
            <div className="divide-y">
              {activeMeal.items.map((item) => (
                <div
                  key={`${item.name}-${item.allergens.join(".")}`}
                  className="px-5 py-3.5 text-[15px] leading-6 font-medium"
                >
                  {item.name}
                </div>
              ))}
            </div>
          </section>
        ) : selectedDay ? (
          <div className="rounded-2xl border bg-card py-12 text-center text-sm text-muted-foreground">
            식단 없음
          </div>
        ) : (
          <div className="h-52 animate-pulse rounded-2xl bg-muted" />
        )}
      </div>
    </div>
  );
}
