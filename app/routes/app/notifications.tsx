import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function NotiPage() {
  return (
    <>
      <PageHeader title="알림" />
      <StubPage title="알림" description="알림 목록이 들어갑니다." />
    </>
  );
}
