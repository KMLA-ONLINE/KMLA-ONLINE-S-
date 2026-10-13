import {
  CakeIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ExternalLinkIcon,
  GiftIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UtensilsIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { schoolLinks } from "~/features/app-shell/model/school-links";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { buttonVariants } from "~/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "3xl",
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
  { to: "/menu/donations", label: "기부물품", icon: GiftIcon },
];

const tileClassName =
  "rounded-xl border bg-card transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function MenuPage() {
  const { profile } = useAppShell();

  return (
    <>
      <PageHeader
        title="메뉴"
        actions={
          <div className="flex items-center gap-1">
            {profile.role === "admin" ? (
              <Tooltip>
                <TooltipTrigger
                  render={<Link to="/admin" />}
                  aria-label="관리자 페이지"
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                >
                  <ShieldCheckIcon aria-hidden />
                </TooltipTrigger>
                <TooltipContent>관리자 페이지</TooltipContent>
              </Tooltip>
            ) : null}
            <Link
              to="/settings"
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

      <div className="flex w-full flex-col gap-6 p-4 md:gap-8 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">메뉴</h1>

        <section
          className="flex flex-col gap-3"
          aria-labelledby="school-tools-title"
        >
          <h2
            id="school-tools-title"
            className="text-sm font-semibold text-muted-foreground"
          >
            학교 기능
          </h2>
          <nav
            aria-label="학교생활 기능"
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
          >
            {shortcuts.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  tileClassName,
                  "flex min-h-22 min-w-0 flex-col items-center justify-center gap-3 px-3 py-4",
                )}
              >
                <Icon className="size-6 text-muted-foreground" aria-hidden />

                {/* `break-keep`이 없으면 두 줄 라벨이 어절 가운데서 잘린다. */}
                <span className="text-center text-sm leading-tight font-medium break-keep">
                  {label}
                </span>
              </Link>
            ))}
          </nav>
        </section>

        <section
          className="flex flex-col gap-3"
          aria-labelledby="school-sites-title"
        >
          <h2
            id="school-sites-title"
            className="text-sm font-semibold text-muted-foreground"
          >
            학교 사이트
          </h2>
          <nav
            aria-label="학교 사이트"
            className="grid grid-cols-2 gap-3 md:grid-cols-3"
          >
            {schoolLinks.map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={`${label} (새 탭)`}
                className={cn(
                  tileClassName,
                  "flex min-h-14 min-w-0 items-center gap-3 px-3 py-3",
                )}
              >
                <Icon
                  className="size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-sm font-medium break-keep">
                  {label}
                </span>
                <ExternalLinkIcon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </a>
            ))}
          </nav>
        </section>
      </div>
    </>
  );
}
