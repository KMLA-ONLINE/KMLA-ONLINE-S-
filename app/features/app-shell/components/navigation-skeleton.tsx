import { cn } from "~/shared/lib/utils";

/**
 * 화면별 스켈레톤은 실제 화면의 뼈대(헤더 높이, 카드 모서리·테두리, 열 구성)만 따라간다.
 * 픽셀 단위로 맞추지는 않는다. 실제 화면의 레이아웃 클래스가 바뀌면 여기도 같이 본다.
 */
export function NavigationSkeleton({ pathname }: { pathname: string }) {
  if (pathname === "/") return <FeedSkeleton />;
  if (pathname === "/groups") return <GroupHomeSkeleton />;
  if (pathname === "/groups/discover") return <GroupDiscoverSkeleton />;
  if (/^\/groups\/(?!create(?:\/|$))[^/]+/.test(pathname)) {
    return <GroupDetailSkeleton />;
  }
  return <GenericSkeleton />;
}

function Block({ className }: { className: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
    />
  );
}

function PendingRegion({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-busy="true"
      aria-label="화면을 불러오는 중"
      className="w-full"
    >
      {children}
      <span className="sr-only" aria-live="polite">
        화면을 불러오는 중입니다.
      </span>
    </section>
  );
}

/** `PageHeader`와 같은 높이·여백. 실제 헤더처럼 모바일에서만 보인다. */
function MobileHeaderSkeleton({
  titleClassName = "w-24",
  actions = 0,
}: {
  titleClassName?: string;
  actions?: number;
}) {
  return (
    <div className="flex h-[calc(var(--app-page-header-h)+var(--app-safe-t))] items-center gap-2 px-3 pt-[var(--app-safe-t)] md:hidden">
      <Block className={cn("h-7 flex-none", titleClassName)} />
      <div className="ml-auto flex items-center gap-1">
        {Array.from({ length: actions }, (_, index) => (
          <Block key={index} className="m-1.5 size-6 rounded-full" />
        ))}
      </div>
    </div>
  );
}

/** `FeedPostCard`의 뼈대. 그룹 상세의 게시물 목록도 같은 카드를 쓴다. */
function PostCardSkeleton({ withImage }: { withImage: boolean }) {
  return (
    <div className="overflow-hidden border-b-2 border-foreground/20 bg-card md:rounded-xl md:border md:border-border md:shadow-sm">
      <div className="flex items-center gap-2 px-4 pt-3 pb-3">
        <Block className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Block className="h-4 w-32" />
          <Block className="h-3 w-20" />
        </div>
      </div>
      <div className="space-y-2 px-4">
        <Block className="h-6 w-3/5" />
        <Block className="h-4 w-full" />
        <Block className="h-4 w-4/5" />
      </div>
      {withImage ? (
        <Block className="mt-3 aspect-[4/3] w-full rounded-none" />
      ) : null}
      <div className="mt-1 flex items-center gap-2 px-2 py-1">
        <Block className="m-1.5 h-5 w-14" />
        <Block className="m-1.5 h-5 w-14" />
        <Block className="m-1.5 ml-auto h-5 w-14" />
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <PendingRegion>
      <MobileHeaderSkeleton titleClassName="w-36" actions={2} />
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:py-4">
        <div className="flex min-w-0 flex-col md:gap-3">
          <PostCardSkeleton withImage />
          <PostCardSkeleton withImage={false} />
          <PostCardSkeleton withImage />
        </div>
        <aside className="hidden space-y-3 self-start lg:block">
          <div className="space-y-3 rounded-xl border bg-card px-4 py-3">
            <Block className="h-4 w-24" />
            <div className="flex gap-2">
              <Block className="size-9 rounded-full" />
              <Block className="size-9 rounded-full" />
              <Block className="size-9 rounded-full" />
            </div>
          </div>
          <div className="space-y-1.5 rounded-xl border bg-card px-4 py-3">
            <Block className="h-4 w-20" />
            <Block className="h-3 w-16" />
          </div>
          <div className="space-y-2 rounded-xl border bg-card p-4">
            <Block className="h-4 w-12" />
            <Block className="h-4 w-full" />
            <Block className="h-4 w-3/4" />
          </div>
        </aside>
      </div>
    </PendingRegion>
  );
}

function GroupHomeSkeleton() {
  return (
    <PendingRegion>
      <MobileHeaderSkeleton titleClassName="w-14" actions={1} />
      <div className="flex w-full flex-col gap-5 px-1 pb-5 md:px-0">
        <div className="hidden items-center justify-between md:flex">
          <Block className="h-8 w-16" />
          <Block className="h-8 w-28" />
        </div>
        <div className="grid grid-cols-2 border-b md:flex md:gap-1">
          <div className="flex justify-center px-4 py-3 md:py-2.5">
            <Block className="h-5 w-8" />
          </div>
          <div className="flex justify-center px-4 py-3 md:py-2.5">
            <Block className="h-5 w-10" />
          </div>
        </div>
        <div className="grid gap-1.5 md:grid-cols-2 md:gap-2">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 md:border md:bg-card"
            >
              <Block className="size-11 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Block className="h-4 w-2/5" />
                <Block className="h-3 w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PendingRegion>
  );
}

function GroupDiscoverSkeleton() {
  return (
    <PendingRegion>
      <MobileHeaderSkeleton titleClassName="w-36" actions={1} />
      <div className="flex w-full flex-col gap-5 px-2 py-5 md:px-0 md:py-0">
        <div className="hidden flex-col gap-2 md:flex">
          <Block className="h-5 w-12" />
          <Block className="h-8 w-44" />
        </div>
        <div className="flex justify-end md:justify-between">
          <Block className="hidden size-8 md:block" />
          <Block className="h-8 w-32 rounded-full md:h-5 md:rounded-md" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:hidden">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="overflow-hidden rounded-xl border bg-card"
            >
              <Block className="aspect-[3/1] w-full rounded-none" />
              <div className="px-2.5 pb-3">
                <div className="-mt-5 mb-1.5 size-10 rounded-full border-3 border-card bg-card">
                  <Block className="size-full rounded-full" />
                </div>
                <Block className="h-4 w-3/4" />
                <Block className="mt-2 h-3 w-2/3" />
                <Block className="mt-2.5 h-8 w-full" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div
              key={item}
              className="overflow-hidden rounded-2xl border bg-card"
            >
              <Block className="aspect-[4/1] w-full rounded-none" />
              <div className="p-4 pt-0">
                <div className="-mt-7 mb-2 size-14 rounded-full border-4 border-card bg-card">
                  <Block className="size-full rounded-full" />
                </div>
                <Block className="h-5 w-2/3" />
                <Block className="mt-2 h-4 w-full" />
                <Block className="mt-1 h-4 w-1/2" />
                <Block className="mt-2 h-3 w-20" />
                <Block className="mt-4 h-8 w-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </PendingRegion>
  );
}

function GroupDetailSkeleton() {
  return (
    <PendingRegion>
      {/* `GroupDetailMobileHeader`: 뒤로가기 · 그룹 아이콘 · 이름 */}
      <div className="flex h-[calc(3rem+var(--app-safe-t))] items-center gap-2 border-b px-2 pt-[var(--app-safe-t)] md:hidden">
        <Block className="m-2 size-5" />
        <Block className="size-7" />
        <Block className="h-5 w-32" />
      </div>
      <div className="pb-10">
        <div className="overflow-hidden sm:rounded-xl sm:border sm:bg-card">
          <Block className="aspect-[4/1] w-full rounded-none" />
          <div className="flex items-start gap-5 p-4 py-2 md:py-4">
            <Block className="hidden size-16 shrink-0 rounded-xl sm:block sm:size-20" />
            <div className="flex-1 space-y-2 pt-1">
              <Block className="h-8 w-48" />
              <Block className="h-4 w-36" />
            </div>
            <Block className="h-8 w-20" />
          </div>
        </div>
        <div className="mx-2 mt-1 hidden gap-1 border-b md:flex">
          {["w-10", "w-8", "w-8"].map((width, index) => (
            <div key={index} className="px-3 py-2">
              <Block className={cn("h-5", width)} />
            </div>
          ))}
        </div>
        <div className="grid gap-6 py-3 md:py-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col md:gap-3">
            <div className="flex items-center gap-3 border-b-2 border-foreground/20 bg-card px-4 py-3 md:rounded-xl md:border md:border-border md:px-3 md:py-2.5">
              <Block className="size-9 shrink-0 rounded-full" />
              <Block className="h-9 flex-1 rounded-full" />
            </div>
            <PostCardSkeleton withImage={false} />
            <PostCardSkeleton withImage />
          </div>
          <aside className="hidden lg:block">
            <div className="space-y-3 rounded-xl border bg-card p-4">
              <Block className="h-4 w-16" />
              <Block className="h-4 w-full" />
              <Block className="h-4 w-4/5" />
            </div>
          </aside>
        </div>
      </div>
    </PendingRegion>
  );
}

function GenericSkeleton() {
  return (
    <PendingRegion>
      <MobileHeaderSkeleton titleClassName="w-28" />
      <div className="space-y-4 p-4 md:p-0">
        <Block className="hidden h-8 w-40 md:block" />
        <Block className="h-32 w-full rounded-xl" />
        <Block className="h-32 w-full rounded-xl" />
      </div>
    </PendingRegion>
  );
}
