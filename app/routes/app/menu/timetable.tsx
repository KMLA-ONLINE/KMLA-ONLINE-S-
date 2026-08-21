import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { TimetableScreen } from "~/features/timetable";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "5xl",
});

export default function TimetablePage() {
  return (
    <>
      <PageHeader title="시간표" back="/menu" />
      <TimetableScreen />
    </>
  );
}
