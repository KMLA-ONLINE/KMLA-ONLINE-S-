import { cn } from "~/shared/lib/utils";

/**
 * 화면 이동 중 이전 화면 위에 띄우는 얇은 진행 막대. 이동이 짧으면 이 막대만 보이고 화면은 바뀌지 않는다.
 * 낭독기에는 알리지 않는다. 오래 걸려 스켈레톤으로 바뀌면 그쪽이 "불러오는 중"을 알린다.
 */
export function NavigationProgress({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-slot="navigation-progress"
      className={cn(
        "pointer-events-none h-0.5 overflow-hidden bg-primary/15",
        className,
      )}
    >
      <div className="h-full w-1/3 animate-navigation-progress bg-primary motion-reduce:w-full motion-reduce:animate-none" />
    </div>
  );
}
