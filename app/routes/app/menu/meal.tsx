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
      <PageHeader title="급식" back="/" />

      <MealScreen
        dates={loaderData.dates}
        initialDate={loaderData.initialDate}
        initialDay={loaderData.initialDay}
      />
    </>
  );
}
