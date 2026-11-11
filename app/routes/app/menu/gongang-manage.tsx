import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { GongangScheduleManager } from "~/features/school-utilities/components/gongang-schedule-manager";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export default function GongangManageRoute() {
  return (
    <>
      <PageHeader title="다음 주 선예약" back="/menu/gongang" />
      <GongangScheduleManager />
    </>
  );
}
