import { useEffect, useState } from "react";

import { cn } from "~/shared/lib/utils";
import { Spinner } from "~/shared/ui/spinner";
import { Switch } from "~/shared/ui/switch";

import {
  ALLERGEN_NAMES,
  getDefaultMeal,
  getMealDay,
  type MealDay,
  type MealMenu,
} from "../data/neis";
import { useShowAllergens } from "../hooks/use-show-allergens";

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

function MealLoading() {
  return (
    <div className="flex justify-center py-16" aria-live="polite">
      <Spinner aria-label="급식 불러오는 중" />
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

function allergenName(code: string) {
  return ALLERGEN_NAMES[code] ?? code;
}

/** 이 끼니에 나온 번호만 오름차순으로 풀이한다. */
function AllergenLegend({ items }: { items: MealMenu["items"] }) {
  const codes = [...new Set(items.flatMap((item) => item.allergens))].sort(
    (a, b) => Number(a) - Number(b),
  );

  if (codes.length === 0) return null;

  return (
    <ul
      aria-label="알레르기 유발 식품"
      className="mt-4 flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground md:px-0"
    >
      {codes.map((code) => (
        <li key={code}>
          <span className="tabular-nums">{code}</span> {allergenName(code)}
        </li>
      ))}
    </ul>
  );
}

interface MealScreenProps {
  dates: string[];
  initialDate: string;
  /** loader가 기다리지 않고 넘긴 첫 날짜의 식단. 오는 동안 식단 칸만 로딩으로 둔다. */
  initialDay: MealDay | Promise<MealDay>;
}

export function MealScreen({
  dates,
  initialDate,
  initialDay,
}: MealScreenProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate);

  const [selectedMeal, setSelectedMeal] = useState(getDefaultMeal);

  const [days, setDays] = useState<Record<string, MealDay>>(() =>
    initialDay instanceof Promise ? {} : { [initialDay.date]: initialDay },
  );

  useEffect(() => {
    if (!(initialDay instanceof Promise)) return;
    let active = true;
    void initialDay.then((day) => {
      if (!active) return;
      setDays((current) =>
        current[day.date] ? current : { ...current, [day.date]: day },
      );
    });
    return () => {
      active = false;
    };
  }, [initialDay]);

  const [showAllergens, setShowAllergens] = useShowAllergens();

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

      <div className="mt-2 flex justify-end">
        <div className="flex min-h-9 items-center gap-2 px-1 text-xs text-muted-foreground md:px-0">
          <span aria-hidden="true">알레르기 표시</span>
          <Switch
            size="sm"
            aria-label="알레르기 표시"
            checked={showAllergens}
            onCheckedChange={setShowAllergens}
          />
        </div>
      </div>

      <div className="mt-1 md:mt-2">
        {loadingDate === selectedDate ? (
          <MealLoading />
        ) : selectedDay?.unavailable ? (
          <MealNotice>불러오지 못했습니다</MealNotice>
        ) : activeMeal ? (
          <>
            <ul className="md:rounded-2xl md:border md:bg-card md:py-2">
              {activeMeal.items.map((item) => (
                <li
                  key={`${item.name}-${item.allergens.join(".")}`}
                  className="px-1 py-2.5 text-[15px] leading-6 md:px-5"
                >
                  {item.name}
                  {showAllergens && item.allergens.length > 0 && (
                    <>
                      <span
                        aria-hidden="true"
                        className="ml-1.5 align-super text-[11px] text-muted-foreground tabular-nums"
                      >
                        {item.allergens.join("·")}
                      </span>
                      <span className="sr-only">
                        , 알레르기:{" "}
                        {item.allergens.map(allergenName).join(", ")}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {showAllergens && <AllergenLegend items={activeMeal.items} />}
          </>
        ) : selectedDay ? (
          <MealNotice>식단 없음</MealNotice>
        ) : (
          <MealLoading />
        )}
      </div>
    </div>
  );
}
