import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  BIRTHDAY_GC_TIME,
  BIRTHDAY_STALE_TIME,
  birthdayKeys,
  BirthdayListScreen,
  listBirthdays,
} from "~/features/profiles";
import { getKoreaDateIso } from "~/shared/lib/korea-date";
import { getQueryClient } from "~/shared/lib/query-client";

import type { Route } from "./+types/birthdays";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "5xl",
});

export async function clientLoader() {
  const referenceDate = getKoreaDateIso();
  const birthdays = await getQueryClient().fetchQuery({
    queryKey: birthdayKeys.month(referenceDate),
    queryFn: () => listBirthdays(referenceDate, "month"),
    staleTime: BIRTHDAY_STALE_TIME,
    gcTime: BIRTHDAY_GC_TIME,
  });

  return { birthdays, referenceDate };
}

export default function BirthdaysPage({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <PageHeader title="생일" back="/menu" />
      <BirthdayListScreen
        birthdays={loaderData.birthdays}
        referenceDate={loaderData.referenceDate}
      />
    </>
  );
}
