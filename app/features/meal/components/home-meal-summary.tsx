import { Link } from "react-router";

import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";
import { getDefaultMeal, type MealDay } from "~/features/meal/data/neis";

export function HomeMealSummary({ day }: { day: MealDay | null }) {
  const meal = day?.meals.find((item) => item.label === getDefaultMeal());

  return (
    <Link
      to="/menu/meal"
      aria-label="급식 보기"
      className="block min-w-0 overflow-hidden rounded-md p-2 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <div>
        {!day || day.unavailable ? (
          <p role="status" className="py-4 text-sm text-muted-foreground">
            급식을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.
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

/** 실제 급식과 같은 제목·2열 메뉴 배치. 최소 높이는 홈의 슬롯이 확보한다. */
export function HomeMealSummarySkeleton() {
  return (
    <PendingRegion label="급식을" className="min-w-0 p-2">
      <div aria-hidden="true">
        <div className="flex h-5 items-center">
          <Skeleton className="h-4 w-10" />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="flex h-6 items-center">
              <Skeleton
                className={index % 2 === 0 ? "h-4 w-3/4" : "h-4 w-full"}
              />
            </div>
          ))}
        </div>
      </div>
    </PendingRegion>
  );
}
