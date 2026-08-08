import { PageHeader } from "~/domains/shell";
import { StubPage } from "~/shared/components/stub-page";

export default function MenuPage() {
  return (
    <>
      <PageHeader title="메뉴" />
      <StubPage title="메뉴" description="설정·바로가기 목록이 들어갑니다." />
    </>
  );
}
