import { cn } from "~/shared/lib/utils";

/**
 * 아이콘 오른쪽 위에 얹는 안 읽음 수.
 *
 * 아이콘에 얹는 이유: 사이드바가 아이콘만 남게 접혀도 보여야 한다.
 * `aria-hidden`인 이유: 링크의 접근성 이름에 이미 "알림 (안 읽음 3개)"로 들어가므로,
 * 여기서 또 읽으면 중복이다.
 */
export function NavBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;

  return (
    <span
      aria-hidden
      className={cn(
        "absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground tabular-nums ring-2",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
