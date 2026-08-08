import { PageHeader } from "~/domains/shell";
import { StubPage } from "~/shared/components/stub-page";

export default function NotiPage() {
  return (
    <>
      <PageHeader title="알림" />
      <StubPage title="알림" description="알림 목록이 들어갑니다." />
    </>
  );
}
