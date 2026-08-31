import {
  CakeIcon,
  CalendarClockIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  CircleQuestionMarkIcon,
  ClipboardListIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UtensilsIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { Link } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { LogoutButton } from "~/features/auth";
import { ListLinkRow } from "~/shared/components/list-link-row";
import { UserAvatar } from "~/shared/components/user-avatar";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

interface Shortcut {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** 재학생에게만 보이는 항목. */
  studentOnly?: boolean;
}

/**
 * 자주 여는 학교 기능.
 *
 * 같은 무게의 행을 아홉 줄 늘어놓으면 원하는 항목을 찾으려고 결국 전부 읽어야 한다. 자주
 * 쓰는 것만 그리드로 올려 한 화면에서 눈으로 집게 하고, 나머지는 아래 목록과 푸터로
 * 내린다 — 이 화면의 위계는 그 세 층이 전부다.
 */
const shortcuts: Shortcut[] = [
  { to: "/menu/meal", label: "급식", icon: UtensilsIcon },
  { to: "/menu/timetable", label: "시간표", icon: CalendarDaysIcon },
  { to: "/util/gongang", label: "공강 · 노래방", icon: CalendarClockIcon },
  { to: "/menu/birthdays", label: "생일", icon: CakeIcon },
  {
    to: "/menu/absence",
    label: "공결 & 병결",
    icon: ClipboardListIcon,
    studentOnly: true,
  },
];

export default function MenuPage() {
  const { profile } = useAppShell();

  const visibleShortcuts = shortcuts.filter(
    (shortcut) => !shortcut.studentOnly || profile.type === "student",
  );

  return (
    <>
      <PageHeader title="메뉴" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">메뉴</h1>

        <Link
          to="/profile"
          className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 transition-colors hover:bg-muted/60"
        >
          <UserAvatar
            src={profile.avatar_url}
            name={profile.name}
            className="size-8"
          />

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{profile.name}</p>
          </div>

          <ChevronRightIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Link>

        <nav
          aria-label="바로가기"
          className="grid grid-cols-3 gap-2 sm:grid-cols-5"
        >
          {visibleShortcuts.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border bg-card px-2 py-3 transition-colors hover:bg-muted/60"
            >
              <Icon className="size-6 text-muted-foreground" aria-hidden />

              {/* 세 칸 그리드에서 "공강 · 노래방"은 두 줄이 된다. `break-keep`이 없으면
                  한국어가 어절 가운데서 잘린다. */}
              <span className="text-center text-xs leading-tight font-medium break-keep">
                {label}
              </span>
            </Link>
          ))}
        </nav>

        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          <ListLinkRow to="/menu/settings" label="설정" icon={SettingsIcon} />

          {profile.role === "admin" ? (
            <ListLinkRow
              to="/admin"
              label="관리자 페이지"
              icon={ShieldCheckIcon}
            />
          ) : null}
        </div>

        {/* 내 것을 바꾸는 설정과 달리 이 둘은 서비스에 대해 읽는 화면이고, 여는 빈도도
            훨씬 낮다. 이 화면의 위계가 빈도이므로 설정 카드에 섞지 않고 한 층 아래 둔다. */}
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          <ListLinkRow
            to="/support"
            label="도움말"
            icon={CircleQuestionMarkIcon}
          />

          <ListLinkRow to="/update" label="업데이트 기록" icon={SparklesIcon} />
        </div>

        {/* 로그아웃은 이동이 아니라 동작이라 목록 카드에서 떼어 따로 앉힌다. */}
        <div className="overflow-hidden rounded-xl border bg-card">
          <LogoutButton appearance="row" />
        </div>

        <div className="pb-2 text-center">
          <Link
            to="/menu/licenses"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            오픈소스 라이선스
          </Link>
        </div>
      </div>
    </>
  );
}
