import { cn } from "~/shared/lib/utils";

/** 아이콘 오른쪽 위 안 읽음 수. 접힌 사이드바에서도 보이도록 아이콘에 얹고, 링크 이름에 이미 들어 있어 `aria-hidden`이다. */
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
