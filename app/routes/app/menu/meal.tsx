import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { useT } from "~/shared/i18n";
import {
  getKoreaWeekDates,
  getMealDay,
  getMealDayIfLoaded,
  getMealReferenceDate,
  MealScreen,
} from "~/features/meal";

import type { Route } from "./+types/meal";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "5xl",
});

/**
 * 급식은 외부 NEIS API라 느리고, 화면에서는 식단 칸 하나만 쓴다. 기다리지 않고 promise째 넘겨
 * 날짜 줄과 끼니 탭을 먼저 그린다. `getMealDay`는 실패를 "불러오지 못했습니다" 값으로 돌려주므로 거부되지 않는다.
 */
export function clientLoader() {
  const initialDate = getMealReferenceDate();
  const dates = getKoreaWeekDates(initialDate);

  return {
    initialDate,
    dates,
    // 받아 둔 날이면 값으로 넘긴다. promise로 넘기면 다시 열 때마다 식단 칸이 한 번 로딩으로 깜빡인다.
    initialDay: getMealDayIfLoaded(initialDate) ?? getMealDay(initialDate),
  };
}

export default function MealPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  return (
    <>
      {/* 급식은 여러 곳에서 열려 경로를 못박지 않고 온 곳으로 돌려보낸다. */}
      <PageHeader title={t("급식")} back />

      <MealScreen
        dates={loaderData.dates}
        initialDate={loaderData.initialDate}
        initialDay={loaderData.initialDay}
      />
    </>
  );
}
