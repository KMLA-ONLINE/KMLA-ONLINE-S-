import { ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";

import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";
import {
  getDefaultMeal,
  getKoreaDate,
  type MealDay,
} from "~/features/meal/data/neis";

export function HomeMealSummary({ day }: { day: MealDay }) {
  const meal = day.meals.find((item) => item.label === getDefaultMeal());

  return (
    <section>
      <Link
        to="/menu/meal"
        className="mb-3 flex items-center justify-between rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted/40"
      >
        <div>
          <p className="text-sm font-semibold">
            {day.date === getKoreaDate() ? "오늘의 급식" : "내일의 급식"}
          </p>
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
    </section>
  );
}

/** 홈 옆 칸이 늦게 채워지는 동안 급식 카드 자리를 잡아 둔다. 비어 있다가 튀어나오지 않게 한다. */
export function HomeMealSummarySkeleton() {
  return (
    <PendingRegion label="급식을" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-xl border bg-card px-4 py-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </PendingRegion>
  );
}
