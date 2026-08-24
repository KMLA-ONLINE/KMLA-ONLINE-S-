import { ShieldCheckIcon, UserCheckIcon, UsersIcon } from "lucide-react";
import { Link, redirect } from "react-router";

import { assertAppAdmin, isAdminAccessError } from "~/features/admin";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";

export const handle = defineAppChrome({ header: "sticky", bottomNav: "none" });

export async function clientLoader() {
  try {
    await assertAppAdmin();
    return null;
  } catch (error) {
    if (isAdminAccessError(error)) throw redirect("/");
    throw error;
  }
}

const links = [
  {
    to: "/admin/approvals",
    title: "가입 승인",
    description: "대기 신청 승인, 차단 및 차단 해제",
    icon: UserCheckIcon,
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
];

export default function AdminHubPage() {
  const { profile } = useAppShell();
  if (profile.role !== "admin") return null;
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
