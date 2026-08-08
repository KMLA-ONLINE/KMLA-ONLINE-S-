import { PageHeader } from "~/domains/shell";
import { StubPage } from "~/shared/components/stub-page";

export default function GroupListPage() {
  return (
    <>
      <PageHeader title="그룹" />
      <StubPage title="그룹" description="내가 속한 그룹 목록이 들어갑니다." />
    </>
  );
}
