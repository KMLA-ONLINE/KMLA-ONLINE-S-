import { PendingRegion, Skeleton } from "~/shared/ui/skeleton";

/** 게시물 카드의 뼈대. 피드·그룹·타임라인이 같은 카드를 쓴다. 카드 레이아웃이 바뀌면 여기도 같이 본다. */
export function PostCardSkeleton({ withImage }: { withImage: boolean }) {
  return (
    <div className="overflow-hidden border-b-2 border-foreground/20 bg-card md:rounded-xl md:border md:border-border md:shadow-sm">
      <div className="flex items-center gap-2 px-4 pt-3 pb-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <div className="space-y-2 px-4">
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      {withImage ? (
        <Skeleton className="mt-3 aspect-[4/3] w-full rounded-none" />
      ) : null}
      <div className="mt-1 flex items-center gap-2 px-2 py-1">
        <Skeleton className="m-1.5 h-5 w-14" />
        <Skeleton className="m-1.5 h-5 w-14" />
        <Skeleton className="m-1.5 ml-auto h-5 w-14" />
      </div>
    </div>
  );
}

/** 게시물 목록 칸만 늦게 채울 때의 자리. 화면 전체 스켈레톤 안에서는 감싸지 않은 카드를 쓴다. */
export function PostListSkeleton() {
  return (
    <PendingRegion label="게시물을" className="flex flex-col md:gap-3">
      <PostCardSkeleton withImage />
      <PostCardSkeleton withImage={false} />
    </PendingRegion>
  );
}
