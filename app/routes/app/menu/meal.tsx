import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  getKoreaWeekDates,
  getMealDay,
  getMealReferenceDate,
  MealScreen,
} from "~/features/meal";

import type { Route } from "./+types/meal";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "5xl",
});

export async function clientLoader() {
  const initialDate = getMealReferenceDate();
  const dates = getKoreaWeekDates(initialDate);

  return {
    initialDate,
    dates,
    initialDay: await getMealDay(initialDate),
  };
}

export default function MealPage({ loaderData }: Route.ComponentProps) {
  return (
    <>
      {/* 다른 화면은 뒤로 갈 곳을 경로로 못박지만, 급식은 홈 헤더와 메뉴 그리드 양쪽에서
          열려서 옳은 경로가 하나로 정해지지 않는다. 온 곳으로 돌려보낸다. */}
      <PageHeader title="급식" back />

      <MealScreen
        dates={loaderData.dates}
        initialDate={loaderData.initialDate}
        initialDay={loaderData.initialDay}
      />
    </>
  );
}
