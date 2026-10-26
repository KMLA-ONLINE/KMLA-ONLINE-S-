import {
  CakeIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ExternalLinkIcon,
  GiftIcon,
  MegaphoneIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UtensilsIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router";

import {
  defineAppChrome,
  PageHeader,
  useAppShell,
  type ShellData,
} from "~/features/app-shell";
import { schoolLinks } from "~/features/app-shell/model/school-links";
import { UserAvatar } from "~/shared/components/user-avatar";
import { useT } from "~/shared/i18n";
import { cn } from "~/shared/lib/utils";
import { buttonVariants } from "~/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "3xl",
});

type ProfileType = ShellData["profile"]["type"];

interface Shortcut {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** 이 타일을 보여 줄 프로필 유형. 없으면 모두에게 보인다. */
  for?: readonly ProfileType[];
}

/**
 * 학교생활 도구만 모으고 계정·서비스 관리는 설정으로 분리한다. 학교 공지·공강·기부물품은 재학생
 * 기능이라 선생님과 졸업생에게 숨기고, 생일은 졸업생에게 숨긴다. 메뉴에서만 숨기며 주소로 들어오는
 * 접근은 막지 않는다.
 */
const shortcuts: Shortcut[] = [
  { to: "/menu/meal", label: "급식", icon: UtensilsIcon },
  {
    to: "/menu/notices",
    label: "학교 공지",
    icon: MegaphoneIcon,
    for: ["student"],
  },
  { to: "/menu/timetable", label: "시간표", icon: CalendarDaysIcon },
  {
    to: "/menu/gongang",
    label: "공강 · 노래방",
    icon: CalendarClockIcon,
    for: ["student"],
  },
  {
    to: "/menu/birthdays",
    label: "생일",
    icon: CakeIcon,
    for: ["student", "teacher"],
  },
  {
    to: "/menu/donations",
    label: "기부물품",
    icon: GiftIcon,
    for: ["student"],
  },
];

const tileClassName =
  "rounded-xl border bg-card transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function MenuPage() {
  const { profile } = useAppShell();
  const t = useT();

  return (
    <>
      <PageHeader
        title={t("메뉴")}
        actions={
          <div className="flex items-center gap-1">
            {profile.role === "admin" ? (
              <Tooltip>
                <TooltipTrigger
                  render={<Link to="/admin" />}
                  aria-label={t("관리자 페이지")}
                  className={buttonVariants({ variant: "ghost", size: "icon" })}
                >
                  <ShieldCheckIcon aria-hidden />
                </TooltipTrigger>
                <TooltipContent>{t("관리자 페이지")}</TooltipContent>
              </Tooltip>
            ) : null}
            <Link
              to="/settings"
              aria-label={t("설정")}
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <SettingsIcon aria-hidden />
            </Link>
            <Link
              to="/profile"
              aria-label={t("내 프로필")}
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
        <h1 className="hidden text-2xl font-semibold md:block">{t("메뉴")}</h1>

        <section
          className="flex flex-col gap-3"
          aria-labelledby="school-tools-title"
        >
          <h2
            id="school-tools-title"
            className="text-sm font-semibold text-muted-foreground"
          >
            {t("학교 기능")}
          </h2>
          <nav
            aria-label={t("학교생활 기능")}
            className="grid grid-cols-2 gap-3 md:grid-cols-4"
          >
            {shortcuts
              .filter(
                (shortcut) =>
                  !shortcut.for || shortcut.for.includes(profile.type),
              )
              .map(({ to, label, icon: Icon }) => (
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
                    {t(label)}
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
            {t("학교 사이트")}
          </h2>
          <nav
            aria-label={t("학교 사이트")}
            className="grid grid-cols-2 gap-3 md:grid-cols-3"
          >
            {schoolLinks.map(({ href, label, icon: Icon }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={t("{label} (새 탭)", { label: t(label) })}
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
                  {t(label)}
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
