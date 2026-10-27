import { ChevronUpIcon } from "lucide-react";
import { useId, type ReactNode } from "react";

import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";

/**
 * 그룹 게시물 탭 위의 접을 수 있는 묶음. 머리줄은 페이스북 그룹의 "대표 콘텐츠 … ^"를 따른다.
 * 접힘은 부모가 든다(목록이 다시 마운트돼도 유지). 저장하지 않는다.
 */
export function GroupPostSection({
  title,
  collapsed,
  onCollapsedChange,
  actions,
  className,
  children,
}: {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const bodyId = useId();

  return (
    <section aria-label={title} className={cn("flex flex-col", className)}>
      <div className="flex items-center gap-1 px-4 md:px-0">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-1">
          {collapsed ? null : actions}
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground"
            aria-label={`${title} ${collapsed ? "펼치기" : "접기"}`}
            aria-expanded={!collapsed}
            aria-controls={collapsed ? undefined : bodyId}
            onClick={() => onCollapsedChange(!collapsed)}
          >
            <ChevronUpIcon
              className={cn(
                "size-4 transition-transform",
                collapsed && "rotate-180",
              )}
            />
          </Button>
        </div>
      </div>
      {collapsed ? null : <div id={bodyId}>{children}</div>}
    </section>
  );
}
