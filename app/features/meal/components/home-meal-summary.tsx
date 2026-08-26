import { ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";

import { getDefaultMeal, type MealDay } from "~/features/meal/data/neis";

export function HomeMealSummary({ day }: { day: MealDay }) {
  const meal = day.meals.find((item) => item.label === getDefaultMeal());

  return (
    <aside className="hidden self-start lg:block">
      <Link
        to="/menu/meal"
        className="mb-3 flex items-center justify-between rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <div>
          <p className="text-sm font-semibold">오늘의 급식</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{day.date}</p>
        </div>
        <ChevronRightIcon className="size-4 text-muted-foreground" />
      </Link>

      <div className="space-y-3">
        {day.unavailable ? (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            급식을 불러오지 못했습니다.
          </p>
        ) : meal ? (
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-sm font-semibold">{meal.label}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {meal.items.map((item) => item.name).join(" · ")}
            </p>
          </section>
        ) : (
          <p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            현재 시간대에 등록된 식단이 없습니다.
          </p>
        )}
      </div>
    </aside>
  );
}
