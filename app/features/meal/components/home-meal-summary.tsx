import { Link } from "react-router";

import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";
import { getDefaultMeal, type MealDay } from "~/features/meal/data/neis";

export function HomeMealSummary({ day }: { day: MealDay }) {
  const meal = day.meals.find((item) => item.label === getDefaultMeal());

  return (
    <Link
      to="/menu/meal"
      aria-label="급식 보기"
      className="block min-w-0 overflow-hidden rounded-md p-2 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div>
        {day.unavailable ? (
          <p className="py-4 text-sm text-muted-foreground">
            급식을 불러오지 못했습니다.
          </p>
        ) : meal ? (
          <section>
            <h2 className="text-sm font-semibold">{meal.label}</h2>
            <ul
              aria-label={`${meal.label} 메뉴`}
              className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm leading-6 break-words text-muted-foreground"
            >
              {meal.items.map((item, index) => (
                <li key={index}>{item.name}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            현재 시간대에 등록된 식단이 없습니다.
          </p>
        )}
      </div>
    </Link>
  );
}

/** 홈 옆 칸이 늦게 채워지는 동안 급식 자리를 잡아 둔다. */
export function HomeMealSummarySkeleton() {
  return (
    <PendingRegion label="급식을" className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 py-3">
        <Skeleton className="h-4 w-10" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </PendingRegion>
  );
}
