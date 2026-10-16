import {
  ContactIcon,
  HardDriveIcon,
  MegaphoneIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  UserCheckIcon,
  UsersIcon,
} from "lucide-react";
import { Link, Navigate } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

const links = [
  {
    to: "/admin/approvals",
    title: "가입 승인",
    description: "대기 신청 승인, 차단 및 차단 해제",
    icon: UserCheckIcon,
  },
  {
    to: "/admin/members",
    title: "전체 인원",
    description: "승인된 사용자를 기수·유형별로 보고 CSV로 내려받기",
    icon: ContactIcon,
  },
  {
    to: "/admin/gongang-managers",
    title: "공강 관리자",
    description: "공강 관리 권한 부여 및 회수",
    icon: ShieldCheckIcon,
  },
  {
    to: "/admin/app-admins",
    title: "앱 관리자",
    description: "앱 관리자 명단, 임명 및 강등",
    icon: UsersIcon,
  },
  {
    to: "/admin/contacts",
    title: "관리자 연락처",
    description: "앱 밖에서 관리자에게 연락할 링크와 이메일",
    icon: MessageCircleIcon,
  },
  {
    to: "/admin/storage-cleanup",
    title: "파일 정리",
    description: "사용하지 않는 파일의 정리 상태 확인",
    icon: HardDriveIcon,
  },
  {
    to: "/admin/school-notices",
    title: "학교 공지 계정",
    description: "공지 동기화에 쓰는 학교 계정 교체와 동기화 상태",
    icon: MegaphoneIcon,
  },
];

/**
 * 링크 모음일 뿐 읽는 데이터가 없어 loader를 두지 않는다. 권한은 셸 프로필의 `role`로 가른다.
 * 실제 권한 확인은 각 하위 관리자 화면의 RPC가 한다.
 */
export default function AdminHubPage() {
  const { profile } = useAppShell();
  if (profile.role !== "admin") return <Navigate to="/" replace />;
  return (
    <>
      <PageHeader title="관리자" back="/menu" />
      <div className="grid gap-4 px-4 py-6 md:grid-cols-3">
        {links.map(({ to, title, description, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors hover:bg-muted/40">
              <CardHeader>
                <Icon className="mb-3 size-6 text-primary" aria-hidden />
                <CardTitle>{title}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {description}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
