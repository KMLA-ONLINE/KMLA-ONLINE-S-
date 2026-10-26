import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { useT } from "~/shared/i18n";
import { TimetableScreen } from "~/features/timetable";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export default function TimetablePage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("시간표")} back="/menu" />
      <TimetableScreen />
    </>
  );
}
