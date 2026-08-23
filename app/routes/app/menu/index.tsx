import {
  CalendarClockIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  UtensilsIcon,
} from "lucide-react";
import { Link } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { UserAvatar } from "~/shared/components/user-avatar";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function MenuPage() {
  const { profile } = useAppShell();

  return (
    <>
      <PageHeader title="메뉴" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
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

        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
            학교
          </h2>

          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            <Link
              to="/menu/meal"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
            >
              <UtensilsIcon
                className="size-4.5 shrink-0 text-muted-foreground"
                aria-hidden
              />

              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                급식
              </span>

              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>

            <Link
              to="/menu/timetable"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
            >
              <CalendarDaysIcon
                className="size-4.5 shrink-0 text-muted-foreground"
                aria-hidden
              />

              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                시간표
              </span>

              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>

            <Link
              to="/util/gongang"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
            >
              <CalendarClockIcon
                className="size-4.5 shrink-0 text-muted-foreground"
                aria-hidden
              />

              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                공강 · 노래방
              </span>

              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
            정보
          </h2>

          <div className="overflow-hidden rounded-xl border bg-card">
            <Link
              to="/menu/licenses"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
            >
              <FileTextIcon
                className="size-4.5 shrink-0 text-muted-foreground"
                aria-hidden
              />

              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                오픈소스 라이선스
              </span>

              <ChevronRightIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
