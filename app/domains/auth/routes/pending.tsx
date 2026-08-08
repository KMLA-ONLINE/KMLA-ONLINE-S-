import { AuthCard } from "~/domains/auth/components/auth-card";

export default function PendingPage() {
  return (
    <AuthCard
      title="승인 대기 중"
      description="관리자가 가입 신청을 확인하면 앱을 쓸 수 있습니다."
    />
  );
}
