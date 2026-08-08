import { PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export default function AdminApprovalsPage() {
  return (
    <>
      <PageHeader title="가입 승인" back />
      <StubPage
        title="가입 승인"
        description="가입 신청 승인/거절이 들어갑니다."
      />
    </>
  );
}
