import { cn } from "~/shared/lib/utils";

export function NavigationSkeleton({ pathname }: { pathname: string }) {
  if (pathname === "/") return <FeedSkeleton />;
  if (pathname === "/groups/discover") return <GroupDiscoverSkeleton />;
  if (/^\/groups\/[^/]+/.test(pathname)) return <GroupDetailSkeleton />;
  if (pathname === "/groups") return <GroupHomeSkeleton />;
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

function FeedSkeleton() {
  return (
    <PendingRegion>
      <div className="h-14 border-b px-4 py-4 md:hidden">
        <Block className="h-6 w-36" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:py-4">
        <div className="space-y-4">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="space-y-4 border-b p-4 md:rounded-xl md:border"
            >
              <div className="flex gap-3">
                <Block className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Block className="h-4 w-40" />
                  <Block className="h-3 w-24" />
                </div>
              </div>
              <Block className="h-4 w-5/6" />
              <Block className="h-4 w-2/3" />
              <Block className="h-32 w-full" />
            </div>
          ))}
        </div>
        <div className="hidden h-64 rounded-xl border p-5 lg:block">
          <Block className="mb-5 h-5 w-28" />
          <Block className="mb-3 h-14 w-full" />
          <Block className="mb-3 h-14 w-full" />
          <Block className="h-14 w-full" />
        </div>
      </div>
    </PendingRegion>
  );
}

function GroupHomeSkeleton() {
  return (
    <PendingRegion>
      <SkeletonHeader />
      <div className="space-y-6 p-4 md:p-0">
        <Block className="h-10 w-full" />
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-xl border p-4"
            >
              <Block className="size-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Block className="h-4 w-2/3" />
                <Block className="h-3 w-1/3" />
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
      <SkeletonHeader />
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 md:p-0">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div key={item} className="overflow-hidden rounded-xl border">
            <Block className="h-24 w-full rounded-none" />
            <div className="space-y-3 p-4">
              <Block className="h-5 w-3/4" />
              <Block className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </PendingRegion>
  );
}

function GroupDetailSkeleton() {
  return (
    <PendingRegion>
      <Block className="h-36 w-full rounded-none md:h-52 md:rounded-xl" />
      <div className="space-y-5 p-4 md:px-0">
        <div className="flex gap-4">
          <Block className="size-16 rounded-full" />
          <div className="flex-1 space-y-3">
            <Block className="h-6 w-48" />
            <Block className="h-4 w-28" />
          </div>
        </div>
        <Block className="h-12 w-full" />
        <div className="space-y-4">
          {[0, 1].map((item) => (
            <div key={item} className="space-y-3 rounded-xl border p-4">
              <Block className="h-5 w-2/3" />
              <Block className="h-4 w-full" />
              <Block className="h-4 w-4/5" />
            </div>
          ))}
        </div>
      </div>
    </PendingRegion>
  );
}

function GenericSkeleton() {
  return (
    <PendingRegion>
      <SkeletonHeader />
      <div className="space-y-4 p-4 md:px-0">
        <Block className="h-10 w-2/3" />
        <Block className="h-32 w-full" />
        <Block className="h-32 w-full" />
      </div>
    </PendingRegion>
  );
}

function SkeletonHeader() {
  return (
    <div className="h-14 border-b px-4 py-4 md:mb-6 md:border-0 md:px-0">
      <Block className="h-6 w-28" />
    </div>
  );
}
