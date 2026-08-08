import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function GroupDiscoverPage() {
  return (
    <>
      <PageHeader title="그룹 찾기" />
      <StubPage
        title="그룹 찾기"
        description="그룹 검색과 추천이 들어갑니다."
      />
    </>
  );
}
