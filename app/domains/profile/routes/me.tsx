import { PageHeader } from "~/domains/shell";
import { StubPage } from "~/shared/components/stub-page";

export default function MyProfilePage() {
  return (
    <>
      <PageHeader title="내 프로필" />
      <StubPage
        title="내 프로필"
        description="내 프로필과 설정이 들어갑니다."
      />
    </>
  );
}
