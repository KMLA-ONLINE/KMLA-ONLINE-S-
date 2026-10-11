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
  return (
    <section
      aria-busy="true"
      aria-label={`${label} 불러오는 중`}
      className={className}
    >
      {children}
      <span className="sr-only" aria-live="polite">
        {label} 불러오는 중입니다.
      </span>
    </section>
  );
}

export { PendingRegion, Skeleton };
