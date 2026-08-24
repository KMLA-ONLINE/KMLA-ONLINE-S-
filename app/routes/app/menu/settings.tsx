import { LayoutGridIcon, ListIcon } from "lucide-react";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { usePostViewMode } from "~/features/posts";
import { cn } from "~/shared/lib/utils";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function SettingsPage() {
  const [viewMode, setViewMode] = usePostViewMode();

  return (
    <>
      <PageHeader title="설정" back="/menu" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">설정</h1>

        <section className="flex flex-col gap-2">
          <div className="px-1">
            <h2 className="text-sm font-semibold">게시물 보기</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              홈 피드와 그룹 게시물에 함께 적용됩니다.
            </p>
          </div>

          <div
            className="grid grid-cols-2 gap-2"
            role="group"
            aria-label="게시물 보기 방식"
          >
            {[
              { value: "card" as const, label: "카드", icon: LayoutGridIcon },
              { value: "list" as const, label: "목록", icon: ListIcon },
            ].map((option) => {
              const Icon = option.icon;
              const selected = viewMode === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setViewMode(option.value)}
                  className={cn(
                    "flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border bg-card text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    selected
                      ? "border-primary text-primary"
                      : "hover:bg-muted/60",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
