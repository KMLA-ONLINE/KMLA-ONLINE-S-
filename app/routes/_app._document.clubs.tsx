import { PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export default function ClubListPage() {
  return (
    <>
      <PageHeader title="동아리" />
      <StubPage title="동아리" description="동아리 목록이 들어갑니다." />
    </>
  );
}
