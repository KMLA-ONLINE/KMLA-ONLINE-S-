import {
  CakeIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  LinkIcon,
  SettingsIcon,
  UtensilsIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { Link, Navigate } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { useDesktopShell } from "~/features/app-shell/model/use-desktop-shell";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { buttonVariants } from "~/shared/ui/button";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

interface Shortcut {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

/** 학교생활 도구만 모으고 계정·서비스 관리는 설정으로 분리한다. */
const shortcuts: Shortcut[] = [
  { to: "/menu/meal", label: "급식", icon: UtensilsIcon },
  { to: "/menu/timetable", label: "시간표", icon: CalendarDaysIcon },
  { to: "/menu/gongang", label: "공강 · 노래방", icon: CalendarClockIcon },
  { to: "/menu/birthdays", label: "생일", icon: CakeIcon },
  { to: "/menu/links", label: "바로가기", icon: LinkIcon },
];

export default function MenuPage() {
  const { profile } = useAppShell();
  const isDesktop = useDesktopShell();

  if (isDesktop) return <Navigate to="/" replace />;

  return (
    <>
      <PageHeader
        title="학교생활"
        actions={
          <div className="flex items-center gap-1">
            <Link
              to="/menu/settings"
              aria-label="설정"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <SettingsIcon aria-hidden />
            </Link>
            <Link
              to="/profile"
              aria-label="내 프로필"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <UserAvatar
                src={profile.avatar_url}
                name={profile.name}
                className="size-8"
              />
            </Link>
          </div>
        }
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">학교생활</h1>

        <nav
          aria-label="학교생활 기능"
          className="grid grid-cols-2 gap-2 sm:grid-cols-5"
        >
          {shortcuts.map(({ to, label, icon: Icon }, index) => (
            <Link
              key={to}
              to={to}
              className={cn(
                "flex min-h-18 flex-col items-center justify-center gap-2 rounded-xl border bg-card px-2 py-3 transition-colors hover:bg-muted/60",
                // 홀수일 때 두 칸 그리드의 마지막
                // 하나가 옆자리를 비운 채 남으므로, 그 하나만 한 줄을 다 쓰게 해 빈칸을 없앤다.
                index === shortcuts.length - 1 &&
                  shortcuts.length % 2 === 1 &&
                  "col-span-2 sm:col-span-1",
              )}
            >
              <Icon className="size-6 text-muted-foreground" aria-hidden />

              {/* `break-keep`이 없으면 두 줄 라벨이 어절 가운데서 잘린다. */}
              <span className="text-center text-xs leading-tight font-medium break-keep">
                {label}
              </span>
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
