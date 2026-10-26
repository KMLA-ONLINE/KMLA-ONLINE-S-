import { useT } from "~/shared/i18n";
import { cn } from "~/shared/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        className,
      )}
      {...props}
    />
  );
}

/** 스켈레톤 묶음을 낭독기에 "불러오는 중" 한 번으로 알린다. 막대 하나하나는 읽히지 않는다. */
function PendingRegion({
  label,
  className,
  children,
}: {
  /** 무엇을 불러오는지, 조사까지. "댓글을"이면 "댓글을 불러오는 중"으로 읽힌다. */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <section
      aria-busy="true"
      aria-label={t("{label} 불러오는 중", { label })}
      className={className}
    >
      {children}
      <span className="sr-only" aria-live="polite">
        {t("{label} 불러오는 중입니다.", { label })}
      </span>
    </section>
  );
}

const LIST_ROW_AVATAR = {
  sm: "size-6",
  default: "size-8",
  lg: "size-10",
} as const;

const LIST_ROW_NAME_WIDTHS = ["w-28", "w-20", "w-24"] as const;

/**
 * 아바타와 이름으로 된 목록(반응·멤버·검색)을 불러오는 동안의 자리. 가운데 스피너보다 결과가 들어설
 * 모양을 미리 보여 준다. `avatar`와 `rowClassName`은 실제 행의 아바타 크기·여백과 맞춘다.
 */
function ListRowSkeleton({
  label,
  rows = 4,
  avatar = "default",
  secondLine = false,
  className,
  rowClassName,
}: {
  /** `PendingRegion`과 같다. "멤버를"이면 "멤버를 불러오는 중"으로 읽힌다. */
  label: string;
  rows?: number;
  avatar?: keyof typeof LIST_ROW_AVATAR;
  /** 이름 밑에 기수처럼 작은 둘째 줄이 있는 행. */
  secondLine?: boolean;
  className?: string;
  rowClassName?: string;
}) {
  return (
    <PendingRegion label={label} className={cn("flex flex-col", className)}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={cn("flex items-center gap-3", rowClassName)}
        >
          <Skeleton
            className={cn("shrink-0 rounded-full", LIST_ROW_AVATAR[avatar])}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton
              className={cn(
                "h-4",
                LIST_ROW_NAME_WIDTHS[index % LIST_ROW_NAME_WIDTHS.length],
              )}
            />
            {secondLine ? <Skeleton className="h-3 w-16" /> : null}
          </div>
        </div>
      ))}
    </PendingRegion>
  );
}

export { ListRowSkeleton, PendingRegion, Skeleton };
