import { ExternalLinkIcon } from "lucide-react";
import { Navigate } from "react-router";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { schoolLinks } from "~/features/app-shell/model/school-links";
import { useDesktopShell } from "~/features/app-shell/model/use-desktop-shell";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function LinksPage() {
  const isDesktop = useDesktopShell();

  if (isDesktop) return <Navigate to="/" replace />;

  return (
    <>
      <PageHeader title="바로가기" back="/menu" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">바로가기</h1>

        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {schoolLinks.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
            >
              <Icon
                className="size-4.5 shrink-0 text-muted-foreground"
                aria-hidden
              />

              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {label}
              </span>

              {/* 앱 안의 화면이 아니라 새 탭으로 나간다는 표시라 화살표 대신 쓴다. */}
              <ExternalLinkIcon
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
