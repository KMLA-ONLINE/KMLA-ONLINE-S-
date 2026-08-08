import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
});

export default function ClubPage() {
  return (
    <>
      <PageHeader title="동아리" back />
      <StubPage title="동아리" description="동아리 상세가 들어갑니다." />
    </>
  );
}
