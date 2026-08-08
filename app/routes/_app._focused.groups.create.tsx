import { PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export default function GroupCreatePage() {
  return (
    <>
      <PageHeader title="그룹 만들기" back />
      <StubPage title="그룹 만들기" description="그룹 생성 폼이 들어갑니다." />
    </>
  );
}
